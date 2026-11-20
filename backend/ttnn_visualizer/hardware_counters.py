# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""tt-metal's hardware counter columns in the ops perf CSV, found by header shape; it
writes only the columns that hold data, so an absent one was not captured. #2371"""

import csv
import math
import re
from array import array
from dataclasses import dataclass, field
from enum import Enum
from typing import (
    Dict,
    FrozenSet,
    Iterable,
    Iterator,
    List,
    Mapping,
    NamedTuple,
    Optional,
    Sequence,
    TextIO,
    Tuple,
)

from ttnn_visualizer.agent.cells import whole_number
from ttnn_visualizer.device_architecture import DeviceArchitecture
from ttnn_visualizer.exceptions import DataFormatError

CAPTURE_FLAG = "--profiler-capture-perf-counters"
MULTIPASS_FLAG = "--perf-counter-multipass"

PM_FPU_UTIL_COLUMN = "PM FPU UTIL (%)"
PM_COMPUTE_COLUMN = "PM COMPUTE [ns]"
DEVICE_ID_COLUMN = "DEVICE ID"
COMPUTE_KERNEL_SOURCE_COLUMN = "COMPUTE KERNEL SOURCE"
# tt-metal's placeholder ideal time for an op its model does not model, as
# `agent.perf_detail.is_unmodelled` reads it.
_UNMODELLED_NS = 1.0

# Three decimals: a percentage reads to a thousandth and a ratio stays non-zero.
_DECIMALS = 3


class CaptureGroup(str, Enum):
    """`--profiler-capture-perf-counters` groups; l1_2 to l1_5 exist on Blackhole only."""

    FPU = "fpu"
    PACK = "pack"
    UNPACK = "unpack"
    INSTRN = "instrn"
    L1_0 = "l1_0"
    L1_1 = "l1_1"
    L1_2 = "l1_2"
    L1_3 = "l1_3"
    L1_4 = "l1_4"
    L1_5 = "l1_5"


BLACKHOLE_ONLY_GROUPS = (
    CaptureGroup.L1_2,
    CaptureGroup.L1_3,
    CaptureGroup.L1_4,
    CaptureGroup.L1_5,
)
_BLACKHOLE_L1_GROUPS = frozenset(BLACKHOLE_ONLY_GROUPS)
_L1_GROUPS = frozenset({CaptureGroup.L1_0, CaptureGroup.L1_1, *BLACKHOLE_ONLY_GROUPS})


class CounterFamily(str, Enum):
    COMPUTE = "compute"
    UNPACK = "unpack"
    PACK = "pack"
    L1_PORTS = "l1_ports"
    NOC_RING = "noc_ring"
    INSTRUCTION_ISSUE = "instruction_issue"
    STALLS = "stalls"
    OTHER = "other"


class CounterStat(str, Enum):
    MIN = "min"
    MEDIAN = "median"
    MAX = "max"
    AVG = "avg"


class CounterMeasure(str, Enum):
    PERCENT = "percent"
    RATIO = "ratio"


class CounterAbsence(str, Enum):
    """Why a counter has no value: never read as 0."""

    NOT_CAPTURED = "not_captured"
    NOT_ON_ARCHITECTURE = "not_on_architecture"
    # The column is in the capture, but this op's cell is blank: tt-metal records no
    # counters for an op without a compute kernel, and a metric whose divisor is 0.
    NO_VALUE = "no_value"


class GroupState(str, Enum):
    FILLED = "filled"
    NOT_CAPTURED = "not_captured"
    NOT_ON_ARCHITECTURE = "not_on_architecture"
    # Blackhole's l1_2 to l1_5 feed means over every L1 group captured, so the CSV
    # cannot say which of them a capture held.
    UNKNOWN = "unknown"


class CounterUnit(str, Enum):
    FPU = "fpu"
    SFPU = "sfpu"
    MATH = "math"
    PACKER = "packer"
    UNPACKER0 = "unpacker0"
    UNPACKER1 = "unpacker1"
    L1_BANDWIDTH = "l1_bandwidth"
    NOC_RING0 = "noc_ring0"
    NOC_RING1 = "noc_ring1"


_STAT_BY_SUFFIX = {
    "Min": CounterStat.MIN,
    "Median": CounterStat.MEDIAN,
    "Max": CounterStat.MAX,
    "Avg": CounterStat.AVG,
}
_MEASURE_BY_SUFFIX = {"%": CounterMeasure.PERCENT, "ratio": CounterMeasure.RATIO}
# tools/tracy/perf_counter_analysis.py `_build_perf_counter_csv_headers`.
_STAT_COLUMN = re.compile(
    r"(?P<label>.+) (?P<stat>Min|Median|Max|Avg) \((?P<measure>%|ratio)\)"
)
# The same module's `_LEGACY_AVG_GRID_COLUMNS`: a count over the kernel duration on
# every compute core of the grid, idle ones included.
_GRID_COLUMN = re.compile(r"Avg (?P<name>\S+) util on full grid \(%\)")

# The architectures the counter tables cover; any other reads as Wormhole or Blackhole.
_COUNTED_ARCHITECTURES = frozenset(
    {
        DeviceArchitecture.WORMHOLE,
        DeviceArchitecture.BLACKHOLE,
        DeviceArchitecture.QUASAR,
    }
)
_TENSIX_1XX = frozenset({DeviceArchitecture.WORMHOLE, DeviceArchitecture.BLACKHOLE})

# Quasar's stall reasons, OR-reduced across its four threads, and each one's share.
_QUASAR_STALL_REASONS = (
    "Tile Counter Stall Pack Rate",
    "Tile Counter Stall Unpack Rate",
    "Srcs Stall Pack Rate",
    "Srcs Stall SFPU Rate",
    "Srcs Stall Unpack Rate",
    "Dest Stall Pack Rate",
    "Dest Stall SFPU Rate",
    "Dest Stall Math Rate",
    "Dest Stall Unpack Rate",
    "SFPU Data Hazard Stall Rate",
    "FPU Data Hazard Stall Rate",
    "SrcB Stall Unpack Rate",
    "SrcA Stall Unpack Rate",
    "Src Valid Stall Math Rate",
    "SrcA Stall Math Rate",
    "SrcB Stall Math Rate",
    "Tile Counter Stall Pack Share",
    "Tile Counter Stall Unpack Share",
    "Srcs Stall Pack Share",
    "Srcs Stall SFPU Share",
    "Srcs Stall Unpack Share",
    "Dest Stall Pack Share",
    "Dest Stall SFPU Share",
    "Dest Stall Math Share",
    "Dest Stall Unpack Share",
    "SFPU Data Hazard Stall Share",
    "FPU Data Hazard Stall Share",
    "SrcB Stall Unpack Share",
    "SrcA Stall Unpack Share",
    "SrcA Stall Math Share",
    "SrcB Stall Math Share",
)

# Vendored from tt-llk's METRIC_LABELS and hardware_reference.md, grouped by unit.
# Labels have been renamed before, so one not listed here falls into OTHER.
_FAMILY_LABELS: Dict[CounterFamily, Tuple[str, ...]] = {
    CounterFamily.COMPUTE: (
        "FPU Util",
        "SFPU Util",
        "MATH Util",
        "FPU SFPU Overlap",
        "Math Pipeline Utilization",
        "FPU Execution Efficiency",
        "Math Src Data Ready Rate",
    ),
    CounterFamily.UNPACK: (
        "Unpacker0 Busy T0 Util",
        "Unpacker1 Busy T0 Util",
        "Unpacker2 Busy T0 Util",
        "Unpacker0 Busy T1 Util",
        "Unpacker1 Busy T1 Util",
        "Unpacker-to-Math Data Flow",
        "Unpacker-to-Math Data Flow (srcA)",
        "Unpacker-to-Math Data Flow (srcB)",
        "SrcA Write Actual Efficiency",
        "SrcB Write Actual Efficiency",
        "SrcA Write Overwrite Blocked Rate",
        "SrcB Write Overwrite Blocked Rate",
        "Unpacker0 T1 Share",
        "Unpacker1 T1 Share",
        "SrcA Write Even-TID Share",
        "SrcB Write Even-TID Share",
        "Compute-to-Unpack Ratio",
    ),
    CounterFamily.PACK: (
        "Packer Utilization",
        "Packer Efficiency",
        "Pack Dest Grant Efficiency",
        "Packer Engine 0 Util",
        "Packer Engine 1 Util",
        "Packer Engine 2 Util",
        "Packer Load Imbalance",
        "Math-to-Pack Handoff Efficiency",
    ),
    CounterFamily.L1_PORTS: (
        "L1 Total Bandwidth Util",
        "L1 Mean Client Util",
        "L1 Unpacker Port Util",
        "L1 Port 1 Util",
        "L1 Port 2 Util",
        "L1 Packer Port 8 Util",
        "L1 TDMA Bundle Util",
        "L1 Unpacker1 Ext Util",
        "L1 Unpacker0 Ext Util",
        "L1 Packer Interfaces Util",
        "L1 Unpacker Backpressure",
        "L1 Port 1 Backpressure",
        "L1 Unpacker1 Ext Backpressure",
        "L1 Unpacker0 Ext Backpressure",
        "L1 Packer Interfaces Backpressure",
        "L1 Read vs Write Ratio",
        "TDMA vs NOC L1 Share",
        "L1 Contention Index",
        "Unpacker L1 Efficiency",
        "Packer L1 Efficiency",
    ),
    CounterFamily.NOC_RING: (
        "NOC Ring 0 Util",
        "NOC Ring 1 Util",
        "NOC Ring 0 Outgoing Util",
        "NOC Ring 0 Incoming Util",
        "NOC Ring 1 Outgoing Util",
        "NOC Ring 1 Incoming Util",
        "NOC Ring 0 Grant Efficiency",
        "NOC Ring 1 Grant Efficiency",
        "NOC Ring 0 Outgoing Backpressure",
        "NOC Ring 0 Incoming Backpressure",
        "NOC Ring 1 Outgoing Backpressure",
        "NOC Ring 1 Incoming Backpressure",
        "NOC Ring 0 Asymmetry",
        "NOC vs Compute Balance",
    ),
    CounterFamily.INSTRUCTION_ISSUE: (
        "T0 Instrn Issue Rate",
        "T1 Instrn Issue Rate",
        "T2 Instrn Issue Rate",
        "T3 Instrn Issue Rate",
        "T0 Instrn Per Issue-Ready Cycle",
        "T1 Instrn Per Issue-Ready Cycle",
        "T2 Instrn Per Issue-Ready Cycle",
        "T3 Instrn Per Issue-Ready Cycle",
        "CFG Instrn Avail Rate T0",
        "CFG Instrn Avail Rate T1",
        "CFG Instrn Avail Rate T2",
        "CFG Instrn Avail Rate T3",
        "SYNC Instrn Avail Rate T0",
        "SYNC Instrn Avail Rate T1",
        "SYNC Instrn Avail Rate T2",
        "SYNC Instrn Avail Rate T3",
        "THCON Instrn Avail Rate T0",
        "THCON Instrn Avail Rate T1",
        "THCON Instrn Avail Rate T2",
        "THCON Instrn Avail Rate T3",
        "MOVE Instrn Avail Rate T0",
        "INSTISSUE Instrn Avail Rate T0",
        "INSTISSUE Instrn Avail Rate T1",
        "INSTISSUE Instrn Avail Rate T2",
        "INSTISSUE Instrn Avail Rate T3",
        "MATH Instrn Avail Rate T0",
        "MATH Instrn Avail Rate T1",
        "MATH Instrn Avail Rate T2",
        "MATH Instrn Avail Rate T3",
        "UNPACK Instrn Avail Rate T0",
        "UNPACK Instrn Avail Rate T1",
        "UNPACK Instrn Avail Rate T2",
        "UNPACK Instrn Avail Rate T3",
        "PACK Instrn Avail Rate T0",
        "PACK Instrn Avail Rate T1",
        "PACK Instrn Avail Rate T2",
        "PACK Instrn Avail Rate T3",
    ),
    CounterFamily.STALLS: (
        "Any-Thread Stall Rate",
        "Thread 0 Stall Rate",
        "Thread 1 Stall Rate",
        "Thread 2 Stall Rate",
        "Thread 3 Stall Rate",
        "Data Hazard Stall Rate",
        "Math Scoreboard Stall Rate",
        "SrcA Valid Wait",
        "SrcB Valid Wait",
        "SrcA Clear Wait",
        "SrcB Clear Wait",
        "Math Idle Wait T1",
        "Pack Idle Wait T2",
        "Unpack Idle Wait T0",
        "Math Waiting on Unpack (T1)",
        "Pack Waiting on Math (T2)",
        "Unpack Waiting on Pack (T0)",
        "SFPU Idle Wait T1",
        "CFG Idle Wait T0",
        "THCON Idle Wait T0",
        "MOVE Idle Wait T0",
        "Semaphore Zero Wait T0",
        "Semaphore Zero Wait T1",
        "Semaphore Zero Wait T2",
        "Semaphore Full Wait T0",
        "Semaphore Full Wait T1",
        "Semaphore Full Wait T2",
        "Stall Overlap T0",
        "Stall Overlap T1",
        "Stall Overlap T2",
        *_QUASAR_STALL_REASONS,
    ),
}


# hardware_reference.md: "A metric whose counters do not exist on the running
# architecture reports N/A". Every L1 and NoC label is N/A on Quasar besides these.
_WORMHOLE_ONLY = frozenset(
    {
        "Packer Engine 0 Util",
        "Packer Engine 1 Util",
        "Packer Engine 2 Util",
        "Packer Load Imbalance",
        "Packer L1 Efficiency",
    }
)
_BLACKHOLE_ONLY = frozenset(
    {
        "L1 Unpacker0 Ext Util",
        "L1 Packer Interfaces Util",
        "L1 Unpacker0 Ext Backpressure",
        "L1 Packer Interfaces Backpressure",
    }
)
_QUASAR_ONLY = frozenset(
    {
        "Thread 3 Stall Rate",
        "T3 Instrn Issue Rate",
        "T3 Instrn Per Issue-Ready Cycle",
        "CFG Instrn Avail Rate T3",
        "SYNC Instrn Avail Rate T3",
        "THCON Instrn Avail Rate T3",
        "INSTISSUE Instrn Avail Rate T0",
        "INSTISSUE Instrn Avail Rate T1",
        "INSTISSUE Instrn Avail Rate T2",
        "INSTISSUE Instrn Avail Rate T3",
        "MATH Instrn Avail Rate T3",
        "UNPACK Instrn Avail Rate T3",
        "PACK Instrn Avail Rate T3",
        "Unpacker2 Busy T0 Util",
        *_QUASAR_STALL_REASONS,
    }
)
_NOT_ON_QUASAR = frozenset(
    {
        *_FAMILY_LABELS[CounterFamily.L1_PORTS],
        *_FAMILY_LABELS[CounterFamily.NOC_RING],
        "Unpacker1 Busy T1 Util",
    }
)


def _architectures(label: str) -> FrozenSet[DeviceArchitecture]:
    if label in _WORMHOLE_ONLY:
        return frozenset({DeviceArchitecture.WORMHOLE})
    if label in _BLACKHOLE_ONLY:
        return frozenset({DeviceArchitecture.BLACKHOLE})
    if label in _QUASAR_ONLY:
        return frozenset({DeviceArchitecture.QUASAR})
    if label in _NOT_ON_QUASAR:
        return _TENSIX_1XX
    return _COUNTED_ARCHITECTURES


FAMILY_BY_LABEL: Dict[str, CounterFamily] = {
    label: family for family, labels in _FAMILY_LABELS.items() for label in labels
}

# The group that fills most of a family's labels, for a family the capture lacks.
FAMILY_GROUPS: Dict[CounterFamily, Tuple[CaptureGroup, ...]] = {
    CounterFamily.COMPUTE: (CaptureGroup.FPU,),
    CounterFamily.UNPACK: (CaptureGroup.UNPACK,),
    CounterFamily.PACK: (CaptureGroup.PACK,),
    CounterFamily.L1_PORTS: (CaptureGroup.L1_0, CaptureGroup.L1_1),
    CounterFamily.NOC_RING: (CaptureGroup.L1_0, CaptureGroup.L1_1),
    CounterFamily.INSTRUCTION_ISSUE: (CaptureGroup.INSTRN,),
    CounterFamily.STALLS: (CaptureGroup.INSTRN,),
    CounterFamily.OTHER: (),
}

# Alternatives, any one of which fills a label; each lists every group it needs.
Requirement = Tuple[Tuple[CaptureGroup, ...], ...]


class _Fill(NamedTuple):
    alternatives: Requirement
    # Read from one group's bank alone, so its column proves a group that fills it ran.
    one_bank: bool = False


def _bank(*groups: CaptureGroup) -> _Fill:
    """A label read from one bank, which any one of `groups` fills alone."""
    return _Fill(tuple((group,) for group in groups), one_bank=True)


def _needs(*alternatives: Tuple[CaptureGroup, ...]) -> _Fill:
    return _Fill(alternatives)


_L1_ORDER = (CaptureGroup.L1_0, CaptureGroup.L1_1, *BLACKHOLE_ONLY_GROUPS)

# Which groups fill a label, as tt-llk's metric engine computes it with only their
# counters on Blackhole; a label not listed is filled by its family's first group.
_FILLS: Dict[str, _Fill] = {
    "FPU Util": _bank(CaptureGroup.FPU),
    "SFPU Util": _bank(CaptureGroup.FPU),
    "MATH Util": _bank(CaptureGroup.FPU),
    "FPU SFPU Overlap": _bank(CaptureGroup.FPU),
    "Packer Utilization": _bank(CaptureGroup.PACK),
    "Packer Efficiency": _bank(CaptureGroup.PACK),
    "Unpacker0 Busy T0 Util": _bank(CaptureGroup.UNPACK),
    "Unpacker1 Busy T0 Util": _bank(CaptureGroup.UNPACK),
    "Math Pipeline Utilization": _bank(CaptureGroup.UNPACK),
    "SrcA Write Actual Efficiency": _bank(CaptureGroup.UNPACK),
    "Math Src Data Ready Rate": _needs((CaptureGroup.UNPACK,)),
    "Data Hazard Stall Rate": _needs((CaptureGroup.UNPACK,)),
    "Any-Thread Stall Rate": _bank(CaptureGroup.INSTRN),
    "Thread 0 Stall Rate": _bank(CaptureGroup.INSTRN),
    "T0 Instrn Issue Rate": _bank(CaptureGroup.INSTRN),
    "L1 Total Bandwidth Util": _bank(CaptureGroup.L1_0),
    "L1 Unpacker Port Util": _bank(CaptureGroup.L1_0),
    "L1 Port 2 Util": _bank(CaptureGroup.L1_0),
    "NOC Ring 0 Outgoing Util": _bank(CaptureGroup.L1_0),
    "L1 Packer Port 8 Util": _bank(CaptureGroup.L1_1),
    "NOC Ring 1 Outgoing Util": _bank(CaptureGroup.L1_1),
    "NOC Ring 1 Incoming Util": _needs((CaptureGroup.L1_1,)),
    "NOC Ring 1 Outgoing Backpressure": _needs((CaptureGroup.L1_1,)),
    "NOC Ring 1 Incoming Backpressure": _needs((CaptureGroup.L1_1,)),
    "L1 Unpacker1 Ext Util": _bank(CaptureGroup.L1_1, CaptureGroup.L1_2),
    "L1 Unpacker1 Ext Backpressure": _needs((CaptureGroup.L1_1,), (CaptureGroup.L1_2,)),
    "NOC Ring 0 Util": _bank(CaptureGroup.L1_0, CaptureGroup.L1_2),
    "NOC Ring 0 Grant Efficiency": _needs((CaptureGroup.L1_0,), (CaptureGroup.L1_2,)),
    "NOC Ring 1 Util": _bank(CaptureGroup.L1_1, CaptureGroup.L1_3),
    "NOC Ring 1 Grant Efficiency": _needs((CaptureGroup.L1_1,), (CaptureGroup.L1_3,)),
    "L1 Packer Interfaces Util": _bank(CaptureGroup.L1_3, CaptureGroup.L1_4),
    "L1 Packer Interfaces Backpressure": _needs(
        (CaptureGroup.L1_3,), (CaptureGroup.L1_4,)
    ),
    "L1 Unpacker0 Ext Util": _bank(CaptureGroup.L1_4, CaptureGroup.L1_5),
    "L1 Unpacker0 Ext Backpressure": _needs((CaptureGroup.L1_4,), (CaptureGroup.L1_5,)),
    "L1 Mean Client Util": _needs(*((group,) for group in _L1_ORDER)),
    "FPU Execution Efficiency": _needs((CaptureGroup.FPU, CaptureGroup.INSTRN)),
    "Compute-to-Unpack Ratio": _needs((CaptureGroup.FPU, CaptureGroup.UNPACK)),
    "Math Scoreboard Stall Rate": _needs((CaptureGroup.PACK, CaptureGroup.UNPACK)),
    "NOC vs Compute Balance": _needs((CaptureGroup.FPU, CaptureGroup.L1_0)),
    "Unpacker L1 Efficiency": _needs((CaptureGroup.UNPACK, CaptureGroup.L1_0)),
    "Packer L1 Efficiency": _needs((CaptureGroup.PACK, CaptureGroup.L1_0)),
}


def _group_anchors() -> Dict[CaptureGroup, Tuple[str, ...]]:
    """The one-bank labels each group fills alone: a column of one proves the group."""
    anchors: Dict[CaptureGroup, List[str]] = {}
    for label, fill in _FILLS.items():
        if fill.one_bank and len(fill.alternatives) == 1:
            (group,) = fill.alternatives[0]
            anchors.setdefault(group, []).append(label)
    return {group: tuple(labels) for group, labels in anchors.items()}


def _blackhole_witnesses() -> Dict[CaptureGroup, Tuple[Tuple[str, CaptureGroup], ...]]:
    """Blackhole's extra L1 groups fill nothing alone: each witness is a one-bank label
    the group fills, with the one other group that fills it too."""
    witnesses: Dict[CaptureGroup, List[Tuple[str, CaptureGroup]]] = {}
    for label, fill in _FILLS.items():
        if not fill.one_bank or len(fill.alternatives) != 2:
            continue
        (first,), (second,) = fill.alternatives
        for group, other in ((first, second), (second, first)):
            if group in BLACKHOLE_ONLY_GROUPS:
                witnesses.setdefault(group, []).append((label, other))
    return {group: tuple(pairs) for group, pairs in witnesses.items()}


_GROUP_ANCHORS = _group_anchors()
_BLACKHOLE_WITNESSES = _blackhole_witnesses()


class HeadlineUnit(NamedTuple):
    unit: CounterUnit
    label: str
    row_key: str

    @property
    def family(self) -> CounterFamily:
        return FAMILY_BY_LABEL[self.label]


HEADLINE_UNITS: Tuple[HeadlineUnit, ...] = (
    HeadlineUnit(CounterUnit.FPU, "FPU Util", "hw_fpu_util"),
    HeadlineUnit(CounterUnit.SFPU, "SFPU Util", "hw_sfpu_util"),
    HeadlineUnit(CounterUnit.MATH, "MATH Util", "hw_math_util"),
    HeadlineUnit(CounterUnit.PACKER, "Packer Utilization", "hw_packer_util"),
    HeadlineUnit(CounterUnit.UNPACKER0, "Unpacker0 Busy T0 Util", "hw_unpacker0_busy"),
    HeadlineUnit(CounterUnit.UNPACKER1, "Unpacker1 Busy T0 Util", "hw_unpacker1_busy"),
    HeadlineUnit(
        CounterUnit.L1_BANDWIDTH, "L1 Total Bandwidth Util", "hw_l1_bandwidth_util"
    ),
    HeadlineUnit(CounterUnit.NOC_RING0, "NOC Ring 0 Util", "hw_noc_ring0_util"),
    HeadlineUnit(CounterUnit.NOC_RING1, "NOC Ring 1 Util", "hw_noc_ring1_util"),
)


class GridUnit(NamedTuple):
    unit: CounterUnit
    column: str
    row_key: str


FULL_GRID_UNITS: Tuple[GridUnit, ...] = (
    GridUnit(CounterUnit.FPU, "Avg FPU util on full grid (%)", "hw_grid_fpu_util"),
    GridUnit(CounterUnit.SFPU, "Avg SFPU util on full grid (%)", "hw_grid_sfpu_util"),
    GridUnit(CounterUnit.MATH, "Avg Math util on full grid (%)", "hw_grid_math_util"),
)

# The Min and Max beside a headline Avg, which only the agent's rows carry (#2330).
MIN_KEY_SUFFIX = "_min"
MAX_KEY_SUFFIX = "_max"


def _exists(group: CaptureGroup, architecture: DeviceArchitecture) -> bool:
    if group in _L1_GROUPS and architecture is DeviceArchitecture.QUASAR:
        return False
    return not (
        group in BLACKHOLE_ONLY_GROUPS
        and architecture in (DeviceArchitecture.WORMHOLE, DeviceArchitecture.QUASAR)
    )


def _flag(
    alternatives: Sequence[Sequence[CaptureGroup]], on_blackhole: bool = False
) -> str:
    choices = " or =".join(
        ",".join(group.value for group in groups) for groups in alternatives
    )
    where = " on Blackhole" if on_blackhole else ""
    hint = f"filled{where} when the capture ran with {CAPTURE_FLAG}={choices}"
    if any(len(_L1_GROUPS.intersection(groups)) > 1 for groups in alternatives):
        hint += f" and {MULTIPASS_FLAG}, since one pass counts one L1 group"
    return hint


_UNGROUPED_HINT = (
    "a counter column this version of the visualizer does not group; it is filled "
    f"when the capture ran with {CAPTURE_FLAG}"
)


def fill_hint(groups: Sequence[CaptureGroup]) -> str:
    """What a capture must ask for to fill a family's counters, naming the flag."""
    return _flag((groups,)) if groups else _UNGROUPED_HINT


def requirement(label: str) -> Requirement:
    if label in _FILLS:
        return _FILLS[label].alternatives
    groups = FAMILY_GROUPS[family_of(label)]
    return ((groups[0],),) if groups else ()


def label_fill_hint(
    label: str, architecture: DeviceArchitecture = DeviceArchitecture.UNKNOWN
) -> str:
    """What a capture must ask for to fill one label on the architecture; where that is
    unknown, only groups every architecture has, or else Blackhole's, named as such."""
    alternatives = [
        groups
        for groups in requirement(label)
        if all(_exists(group, architecture) for group in groups)
    ]
    if alternatives and architecture not in _COUNTED_ARCHITECTURES:
        everywhere = [
            groups
            for groups in alternatives
            if not _BLACKHOLE_L1_GROUPS.intersection(groups)
        ]
        if not everywhere:
            return _flag(alternatives, on_blackhole=True)
        alternatives = everywhere
    return _flag(alternatives) if alternatives else _UNGROUPED_HINT


# tt-metal fills the grid columns from the kernel duration, which a device-only run lacks.
GRID_FILL_HINT = (
    fill_hint((CaptureGroup.FPU,))
    + ", profiling the host too: a device-only run has none"
)

# Every key `report_columns` can add to a report row.
REPORT_ROW_KEYS = frozenset(
    {
        *(
            unit.row_key + suffix
            for unit in HEADLINE_UNITS
            for suffix in ("", MIN_KEY_SUFFIX, MAX_KEY_SUFFIX)
        ),
        *(grid.row_key for grid in FULL_GRID_UNITS),
    }
)


class CounterColumn(NamedTuple):
    label: str
    stat: CounterStat
    measure: CounterMeasure


def counter_column(name: str) -> Optional[CounterColumn]:
    """A `<Label> <Stat> (%|ratio)` column's parts, or None for any other column."""
    found = _STAT_COLUMN.fullmatch(name.strip())
    if found is None:
        return None
    return CounterColumn(
        found["label"],
        _STAT_BY_SUFFIX[found["stat"]],
        _MEASURE_BY_SUFFIX[found["measure"]],
    )


def family_of(label: str) -> CounterFamily:
    return FAMILY_BY_LABEL.get(label, CounterFamily.OTHER)


def labels_of(family: CounterFamily) -> Tuple[str, ...]:
    """The vendored labels of a family; OTHER has none, being what is left over."""
    return _FAMILY_LABELS.get(family, ())


def group_states(
    header: "CounterHeader", architecture: DeviceArchitecture
) -> Dict[CaptureGroup, GroupState]:
    """Whether the capture filled each `--profiler-capture-perf-counters` group."""
    states: Dict[CaptureGroup, GroupState] = {}
    for group in CaptureGroup:
        if not _exists(group, architecture):
            states[group] = GroupState.NOT_ON_ARCHITECTURE
        elif group in _GROUP_ANCHORS:
            filled = any(label in header.columns for label in _GROUP_ANCHORS[group])
            states[group] = GroupState.FILLED if filled else GroupState.NOT_CAPTURED
        elif any(
            label not in header.columns for label, _ in _BLACKHOLE_WITNESSES[group]
        ):
            states[group] = GroupState.NOT_CAPTURED
    for group, witnesses in _BLACKHOLE_WITNESSES.items():
        if group in states:
            continue
        alone = any(
            label in header.columns and states.get(other) is GroupState.NOT_CAPTURED
            for label, other in witnesses
        )
        states[group] = GroupState.FILLED if alone else GroupState.UNKNOWN
    return {group: states[group] for group in CaptureGroup}


def is_available(label: str, architecture: DeviceArchitecture) -> bool:
    """Whether the label can be filled there; where unknown, on Wormhole or Blackhole."""
    possible = {architecture} if architecture in _COUNTED_ARCHITECTURES else _TENSIX_1XX
    return bool(_architectures(label) & possible)


def is_listed(label: str, architecture: DeviceArchitecture) -> bool:
    """Whether a listing of every counter names it: a Quasar-only one only on Quasar."""
    return is_available(label, architecture) or bool(
        _architectures(label) & _TENSIX_1XX
    )


@dataclass(frozen=True)
class CounterHeader:
    """The counter columns one CSV header holds."""

    # Label to stat to the column's name as the header writes it, in header order.
    columns: Dict[str, Dict[CounterStat, str]] = field(default_factory=dict)
    measures: Dict[str, CounterMeasure] = field(default_factory=dict)
    # A full-grid column's lower-cased unit name ("fpu") to its name in the header.
    full_grid: Dict[str, str] = field(default_factory=dict)

    @property
    def has_counters(self) -> bool:
        return bool(self.columns or self.full_grid)

    def column(self, label: str, stat: CounterStat) -> Optional[str]:
        return self.columns.get(label, {}).get(stat)

    def every_column(self) -> List[str]:
        return [
            *(name for stats in self.columns.values() for name in stats.values()),
            *self.full_grid.values(),
        ]

    def absence(
        self, label: str, architecture: DeviceArchitecture
    ) -> Optional[CounterAbsence]:
        """Why the capture has no column for `label`, or None when it has one."""
        if label in self.columns:
            return None
        if not is_available(label, architecture):
            return CounterAbsence.NOT_ON_ARCHITECTURE
        return CounterAbsence.NOT_CAPTURED


def discover(header: Iterable[object]) -> CounterHeader:
    """The counter columns among `header`, found by the shapes tt-metal writes."""
    discovered = CounterHeader()
    for name in header:
        if not isinstance(name, str):
            continue
        column = counter_column(name)
        if column is not None:
            discovered.columns.setdefault(column.label, {})[column.stat] = name
            discovered.measures[column.label] = column.measure
            continue
        grid = _GRID_COLUMN.fullmatch(name.strip())
        if grid is not None:
            discovered.full_grid[grid["name"].lower()] = name
    return discovered


def cell_value(cell: object) -> Optional[float]:
    """A counter cell as a number, or None for a blank, unreadable or non-finite one."""
    if isinstance(cell, bool) or cell is None:
        return None
    try:
        number = float(cell) if isinstance(cell, (int, float, str)) else math.nan
    except ValueError:
        return None
    return round(number, _DECIMALS) if math.isfinite(number) else None


def report_columns(header: CounterHeader, detail: bool) -> Dict[str, str]:
    """The keys a report row gains, each with the column it copies: none without counters,
    so such a report's rows are unchanged, and the Min and Max only with `detail`."""
    columns: Dict[str, str] = {}
    for unit in HEADLINE_UNITS:
        average = header.column(unit.label, CounterStat.AVG)
        if average is not None:
            columns[unit.row_key] = average
        if not detail:
            continue
        for stat, suffix in (
            (CounterStat.MIN, MIN_KEY_SUFFIX),
            (CounterStat.MAX, MAX_KEY_SUFFIX),
        ):
            name = header.column(unit.label, stat)
            if name is not None:
                columns[unit.row_key + suffix] = name
    for grid in FULL_GRID_UNITS:
        name = header.full_grid.get(grid.unit.value)
        if name is not None:
            columns[grid.row_key] = name
    return columns


def _stats(
    row: Mapping[str, object], header: CounterHeader, label: str
) -> Dict[str, Optional[float]]:
    stats: Dict[str, Optional[float]] = {}
    for stat in CounterStat:
        name = header.column(label, stat)
        stats[stat.value] = cell_value(row.get(name)) if name else None
    return stats


def _reading(
    row: Mapping[str, object],
    header: CounterHeader,
    label: str,
    architecture: DeviceArchitecture,
) -> Dict[str, object]:
    stats = _stats(row, header, label)
    absence = header.absence(label, architecture)
    if absence is None and all(value is None for value in stats.values()):
        absence = CounterAbsence.NO_VALUE
    measure = header.measures.get(label)
    return {
        "label": label,
        "measure": measure.value if measure else None,
        **stats,
        "absence": absence.value if absence else None,
        "fill_hint": (
            label_fill_hint(label, architecture)
            if absence is CounterAbsence.NOT_CAPTURED
            else None
        ),
    }


def _family_labels(
    family: CounterFamily, header: CounterHeader, architecture: DeviceArchitecture
) -> List[str]:
    if family is CounterFamily.OTHER:
        return [label for label in header.columns if label not in FAMILY_BY_LABEL]
    return [label for label in _FAMILY_LABELS[family] if is_listed(label, architecture)]


def performance_model(row: Mapping[str, object]) -> Dict[str, Optional[float]]:
    """The perf model's FPU utilisation, null where tt-metal left its 1 ns placeholder."""
    if cell_value(row.get(PM_COMPUTE_COLUMN)) == _UNMODELLED_NS:
        return {"fpu_util": None}
    return {"fpu_util": cell_value(row.get(PM_FPU_UTIL_COLUMN))}


def _has_compute_kernel(row: Mapping[str, object]) -> Optional[bool]:
    """Whether the row names a compute kernel, which tt-metal writes as `[]` for an op
    with none; None where the CSV has no such column or leaves the cell blank."""
    cell = row.get(COMPUTE_KERNEL_SOURCE_COLUMN)
    if not isinstance(cell, str) or not cell.strip():
        return None
    return bool(cell.strip().strip("[]").strip())


def _row_facts(
    row: Mapping[str, object], architecture: DeviceArchitecture
) -> Dict[str, object]:
    """The row's device and compute kernel, which the panel names when it says whose
    counters these are and why an op has none."""
    return {
        "architecture": architecture.value or None,
        "device_id": whole_number(row.get(DEVICE_ID_COLUMN)),
        "has_compute_kernel": _has_compute_kernel(row),
        "performance_model": performance_model(row),
    }


def operation_counters(
    row: Mapping[str, object],
    header: CounterHeader,
    architecture: DeviceArchitecture,
) -> Dict[str, object]:
    """One performance row's counters, by headline unit and by family. #2371"""
    facts = _row_facts(row, architecture)
    if not header.has_counters:
        return {
            "has_counters": False,
            "op_has_counters": False,
            "units": [],
            "full_grid": [],
            "families": [],
            **facts,
        }

    families = []
    for family in CounterFamily:
        labels = _family_labels(family, header, architecture)
        if not labels:
            continue
        families.append(
            {
                "family": family.value,
                "captured": any(label in header.columns for label in labels),
                "fill_hint": fill_hint(FAMILY_GROUPS[family]),
                "metrics": [
                    _reading(row, header, label, architecture) for label in labels
                ],
            }
        )

    units = [
        {
            "unit": unit.unit.value,
            "family": unit.family.value,
            **_reading(row, header, unit.label, architecture),
        }
        for unit in HEADLINE_UNITS
    ]
    full_grid = [
        {
            "unit": grid.unit.value,
            "column": name,
            "value": cell_value(row.get(name)),
        }
        for grid in FULL_GRID_UNITS
        if (name := header.full_grid.get(grid.unit.value)) is not None
    ]
    return {
        "has_counters": True,
        "op_has_counters": any(
            cell_value(row.get(name)) is not None for name in header.every_column()
        ),
        "units": units,
        "full_grid": full_grid,
        "families": families,
        **facts,
    }


def _rows(source: TextIO) -> Iterator[List[str]]:
    """The data rows as the generator's `csv.DictReader` counts them, which a report row's
    id names: it skips only empty lines."""
    for row in csv.reader(source):
        if row:
            yield row


def read_row(
    source: TextIO, position: int
) -> Tuple[List[str], Optional[Dict[str, str]]]:
    """The header and the data row at `position`, or None past the last one."""
    try:
        rows = _rows(source)
        header = next(rows, [])
        if position < 0:
            return header, None
        for index, row in enumerate(rows):
            if index == position:
                return header, dict(zip(header, row))
        return header, None
    except (csv.Error, UnicodeDecodeError) as error:
        raise DataFormatError(
            f"the performance CSV could not be read: {error}"
        ) from error


@dataclass(frozen=True)
class CounterTable:
    """Every counter column of a capture, one float per data row, NaN where blank."""

    header: CounterHeader
    values: Dict[str, "array[float]"]
    row_count: int

    def value(self, column: Optional[str], position: int) -> Optional[float]:
        if column is None or not 0 <= position < self.row_count:
            return None
        number = self.values[column][position]
        return None if math.isnan(number) else number


def _float_or_nan(cell: str) -> float:
    value = cell_value(cell)
    return math.nan if value is None else value


def read_table(source: TextIO) -> CounterTable:
    """The capture's counter columns for every row, read in one pass."""
    try:
        rows = _rows(source)
        header = next(rows, [])
        counters = discover(header)
        index_by_column = {name: header.index(name) for name in counters.every_column()}
        values: Dict[str, "array[float]"] = {
            name: array("d") for name in index_by_column
        }
        row_count = 0
        for row in rows:
            row_count += 1
            width = len(row)
            for name, index in index_by_column.items():
                values[name].append(
                    _float_or_nan(row[index]) if index < width else math.nan
                )
        return CounterTable(counters, values, row_count)
    except (csv.Error, UnicodeDecodeError) as error:
        raise DataFormatError(
            f"the performance CSV could not be read: {error}"
        ) from error


__all__ = [
    "BLACKHOLE_ONLY_GROUPS",
    "CAPTURE_FLAG",
    "FAMILY_BY_LABEL",
    "FAMILY_GROUPS",
    "FULL_GRID_UNITS",
    "GRID_FILL_HINT",
    "HEADLINE_UNITS",
    "MAX_KEY_SUFFIX",
    "MIN_KEY_SUFFIX",
    "MULTIPASS_FLAG",
    "Requirement",
    "REPORT_ROW_KEYS",
    "CaptureGroup",
    "CounterAbsence",
    "CounterFamily",
    "CounterHeader",
    "CounterMeasure",
    "CounterStat",
    "CounterTable",
    "CounterUnit",
    "GridUnit",
    "GroupState",
    "HeadlineUnit",
    "cell_value",
    "counter_column",
    "discover",
    "family_of",
    "fill_hint",
    "group_states",
    "is_available",
    "is_listed",
    "label_fill_hint",
    "labels_of",
    "operation_counters",
    "performance_model",
    "read_row",
    "read_table",
    "report_columns",
    "requirement",
]
