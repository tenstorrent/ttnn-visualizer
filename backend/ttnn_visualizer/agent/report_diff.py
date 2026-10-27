# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""What `diff_reports` calls a change (#2155): thresholds, groups one side lacks, and
medians over repeated captures.

Pure: `tools.diff_reports` reads the reports, and this decides what their totals say.
"""

from dataclasses import dataclass
from enum import Enum
from statistics import median, median_low
from typing import Callable, Dict, FrozenSet, Hashable, List, Optional, Tuple, cast

from ttnn_visualizer.agent.cells import finite_number


class DiffMatch(str, Enum):
    """What makes a row of one report the same operation as a row of the other."""

    OP_CODE = "op_code"
    # The raw op code with its tensors' shapes, layouts, dtypes and memory.
    SIGNATURE = "signature"


DIFF_MATCHES = frozenset(match.value for match in DiffMatch)


@dataclass(frozen=True)
class DiffMetric:
    """How a summable metric's moves are judged and caveated."""

    min_delta: float
    unit: str
    caveat: Optional[str] = None


# Keyed as `tools.ADDITIVE_METRICS`, which a test holds them to.
DIFF_METRICS: Dict[str, DiffMetric] = {
    # A percentage of a tiny figure is mostly jitter, so a change must also move this much.
    "device_time": DiffMetric(min_delta=1.0, unit="us"),
    "op_to_op_gap": DiffMetric(
        min_delta=1.0,
        unit="us",
        caveat=(
            "Op-to-op gaps are host time between operations, including dispatch and a "
            "program's compilation on its first call, so they can move several-fold "
            "between two runs of the same code; device_time is what a kernel change "
            "moves."
        ),
    ),
    "total_percent": DiffMetric(
        min_delta=0.1,
        unit="percentage_points",
        caveat=(
            "total_percent is a group's share of its own report's device time and "
            "op-to-op gap together, so it carries the gaps' run-to-run noise and moves "
            "whenever any other group does; compare device_time to see whether the "
            "group itself changed."
        ),
    ),
}

# Above run-to-run noise: two captures of the same code moved an op code's device time
# by up to 3.8% and 4.3%, so a smaller move with one capture a side is not a finding.
DEFAULT_MIN_PERCENT = 5.0
# Each capture is a report the call may generate, so this bounds one call's work.
MAX_CAPTURES_PER_SIDE = 5
# A local MoE expert op's 30 tensors run to 1,550 characters of signature.
MAX_SIGNATURE_CHARS = 300

DIFF_NOTE = (
    "A group is tt-perf-report's op code, which names a matmul's shapes and a conv's "
    "config, or with match signature a raw op code and its tensors. A change is a "
    "group both reports ran that moved by at least min_percent of its before figure "
    "and by at least min_delta; within_threshold_count counts those that moved less. "
    "A group only one report ran is listed under new or missing, and one with no "
    "figure on a side under unmeasured, never as a change. With repeats, a side's "
    "figure is the median of its captures', and a group they disagree on, by whether "
    "or how often it ran, is listed under inconsistent."
)

SIGNATURE_NOISE_CAVEAT = (
    "A signature groups fewer calls than an op code, so it moves more between runs of "
    "the same code: on two such runs a two-call signature moved 18% while no op code "
    "moved 5%. Compare repeats, or raise min_percent, before reading a signature's "
    "move as a change."
)

# Facts of the hardware a capture ran on, any of which moves every figure.
HARDWARE_FACTS = ("arch", "clock_mhz", "max_compute_cores", "device_count")


@dataclass(frozen=True)
class Thresholds:
    percent: float
    floor: float

    def passes(self, before: float, move: float) -> bool:
        """Whether a move counts as a change: past both thresholds, as tt-metal's LLK
        perf-regression check calls one. A move from zero has no percentage to miss."""
        if move == 0 or abs(move) < self.floor:
            return False
        return before == 0 or abs(move) / abs(before) * 100 >= self.percent


def threshold(name: str, value: object, default: float) -> float:
    if value is None:
        return default
    number = finite_number(value)
    if number is None or number < 0:
        raise ValueError(f"{name} must be a number of at least 0, not {value!r}")
    return number


def captures(label: str, handle: str, repeats: object) -> List[str]:
    """One side of a diff: its handle and the repeats measured with it."""
    if repeats is None:
        return [handle]
    if not isinstance(repeats, list) or not all(
        isinstance(repeat, str) for repeat in repeats
    ):
        raise ValueError(f"{label} must be a list of handles, not {repeats!r}")
    if len(repeats) >= MAX_CAPTURES_PER_SIDE:
        raise ValueError(
            f"{label} takes at most {MAX_CAPTURES_PER_SIDE - 1} handles, since each "
            "capture is a report the call generates"
        )
    return [handle, *repeats]


@dataclass
class GroupTotal:
    """A group's calls, how many of them carry a figure, and the figures' sum.

    tt-perf-report leaves a call's figure blank where its duration is invalid, as it
    does a report's first op-to-op gap.
    """

    total: float = 0.0
    count: int = 0
    measured: int = 0


@dataclass(frozen=True)
class CaptureTotals:
    """One capture's group totals for every metric, and the sub-devices its rows name."""

    by_metric: Dict[str, Dict[Hashable, GroupTotal]]
    sub_devices: FrozenSet[str]


def capture_totals(
    rows: List[Dict],
    fields: Dict[str, str],
    key_of: Callable[[Dict], Optional[Hashable]],
    sub_devices: FrozenSet[str],
) -> CaptureTotals:
    """Sum each metric's `fields[metric]` by group: every row is a call of its group,
    and only a row with a figure adds to the sum."""
    by_metric: Dict[str, Dict[Hashable, GroupTotal]] = {metric: {} for metric in fields}
    for row in rows:
        key = key_of(row)
        if key is None:
            continue
        for metric, field in fields.items():
            groups = by_metric[metric]
            group = groups.get(key)
            if group is None:
                group = groups[key] = GroupTotal()
            group.count += 1
            value = finite_number(row.get(field))
            if value is not None:
                group.total += value
                group.measured += 1
    return CaptureTotals(by_metric, sub_devices)


@dataclass(frozen=True)
class Side:
    """One side's groups across its captures.

    `figures` holds the medians of the groups every capture ran equally often and gave a
    figure, and `unmeasured` the groups every capture ran equally often but one left
    without any. `measured` holds the groups some capture gave a figure, `calls` each
    group's calls per capture, `least_measured` the fewest calls with a figure in any
    capture, and `largest` each group's largest sum.
    """

    figures: Dict[Hashable, GroupTotal]
    unmeasured: FrozenSet[Hashable]
    measured: FrozenSet[Hashable]
    calls: Dict[Hashable, Tuple[int, ...]]
    least_measured: Dict[Hashable, int]
    largest: Dict[Hashable, float]
    total: float

    @classmethod
    def of(cls, captures: List[Dict[Hashable, GroupTotal]]) -> "Side":
        keys = list(dict.fromkeys(key for capture in captures for key in capture))
        calls = {
            key: tuple(
                capture[key].count if key in capture else 0 for capture in captures
            )
            for key in keys
        }
        least_measured = {
            key: min(
                capture[key].measured if key in capture else 0 for capture in captures
            )
            for key in keys
        }
        largest = {
            key: max(capture[key].total for capture in captures if key in capture)
            for key in keys
        }
        figures = {}
        unmeasured = set()
        for key in keys:
            if len(set(calls[key])) != 1:
                continue
            if least_measured[key] == 0:
                unmeasured.add(key)
                continue
            groups = [capture[key] for capture in captures]
            figures[key] = GroupTotal(
                median(group.total for group in groups),
                calls[key][0],
                median_low(group.measured for group in groups),
            )
        measured = frozenset(
            key
            for key in keys
            if any(capture[key].measured for capture in captures if key in capture)
        )
        total = median(
            sum(group.total for group in capture.values()) for capture in captures
        )
        return cls(
            figures,
            frozenset(unmeasured),
            measured,
            calls,
            least_measured,
            largest,
            total,
        )

    def ran(self, key: Hashable) -> bool:
        """Whether every capture ran the group, and equally often."""
        counts = self.calls.get(key)
        return counts is not None and len(set(counts)) == 1

    def disagrees(self, key: Hashable) -> bool:
        """Whether the side's captures disagree on whether, or how often, it ran."""
        return key in self.calls and not self.ran(key)


def group_fields(key: Hashable, match: DiffMatch) -> Dict[str, object]:
    """A group as an answer names it. A signature's code is the raw one, which
    tt-perf-report has not suffixed with a matmul's shapes or a conv's config."""
    if match is DiffMatch.OP_CODE:
        return {"op_code": key}
    raw_op_code, signature = cast(Tuple[str, str], key)
    fields: Dict[str, object] = {
        "raw_op_code": raw_op_code,
        "signature": signature[:MAX_SIGNATURE_CHARS] or None,
    }
    if len(signature) > MAX_SIGNATURE_CHARS:
        fields["signature_full_length"] = len(signature)
    return fields


def delta(before: float, after: float) -> float:
    """The move between two figures as the answer rounds them, so equal figures move
    by zero rather than by float noise, and never by a negative zero."""
    return round(round(after, 3) - round(before, 3), 3) + 0.0


def _described(values: Dict[str, object]) -> str:
    return ", ".join(f"{handle} {value}" for handle, value in values.items())


def mismatch_caveat(mismatched: Dict[str, Dict[str, object]]) -> str:
    sentences = []
    hardware = [fact for fact in HARDWARE_FACTS if fact in mismatched]
    if hardware:
        described = "; ".join(
            f"{fact} ({_described(mismatched[fact])})" for fact in hardware
        )
        sentences.append(
            f"The captures differ in {described}, so every delta measures that "
            "difference as well as any change in the code."
        )
    if "tensor_sizes" in mismatched:
        sentences.append(
            "The captures record tensor sizes differently "
            f"({_described(mismatched['tensor_sizes'])}), so a tile-padded tensor's "
            "signature differs between them and its ops land under new and missing."
        )
    return " ".join(sentences)


__all__ = [
    "DEFAULT_MIN_PERCENT",
    "DIFF_MATCHES",
    "DIFF_METRICS",
    "DIFF_NOTE",
    "HARDWARE_FACTS",
    "MAX_CAPTURES_PER_SIDE",
    "MAX_SIGNATURE_CHARS",
    "SIGNATURE_NOISE_CAVEAT",
    "CaptureTotals",
    "DiffMatch",
    "DiffMetric",
    "GroupTotal",
    "Side",
    "Thresholds",
    "capture_totals",
    "captures",
    "delta",
    "group_fields",
    "mismatch_caveat",
    "threshold",
]
