# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""What `diff_reports` calls a change (#2155): thresholds, groups one side lacks, and
medians over repeated captures.

Pure: `tools.diff_reports` reads the reports, and this decides what their totals say.
"""

from dataclasses import dataclass
from enum import Enum
from statistics import median
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
# Enough for any number or handle list an agent means to pass.
_MAX_ECHOED_CHARS = 64

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
# Whether a capture's CSV records a tensor's logical size beside its padded one.
TENSOR_SIZES = "tensor_sizes"
COMPARED_FACTS = (*HARDWARE_FACTS, TENSOR_SIZES)


def _echoed(value: object) -> str:
    """`value` as a refusal names it, cut so an argument cannot fill the answer."""
    shown = repr(value)
    if len(shown) <= _MAX_ECHOED_CHARS:
        return shown
    return f"{shown[:_MAX_ECHOED_CHARS]}... ({len(shown)} characters)"


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
        raise ValueError(f"{name} must be a number of at least 0, not {_echoed(value)}")
    return number


def side_handles(label: str, handle: str, repeats: object) -> List[str]:
    """One side of a diff: its handle and the repeats measured with it."""
    if repeats is None:
        return [handle]
    if not isinstance(repeats, list) or not all(
        isinstance(repeat, str) for repeat in repeats
    ):
        raise ValueError(f"{label} must be a list of handles, not {_echoed(repeats)}")
    if len(repeats) >= MAX_CAPTURES_PER_SIDE:
        raise ValueError(
            f"{label} takes at most {MAX_CAPTURES_PER_SIDE - 1} handles, since each "
            "capture is a report the call generates"
        )
    return [handle, *repeats]


@dataclass(slots=True)
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


def _measured_behind_median(totals: List[GroupTotal]) -> int:
    """The fewest measured calls among the captures a median total comes from, both
    middle ones for an even count, so a partial capture's sum never reads as complete.
    """
    ranked = sorted(group.total for group in totals)
    low, high = ranked[(len(ranked) - 1) // 2], ranked[len(ranked) // 2]
    return min(group.measured for group in totals if low <= group.total <= high)


@dataclass(frozen=True)
class Side:
    """One side's groups across its captures.

    `figures_by_group` holds the medians of the groups every capture ran equally often
    and gave a figure, each with the measured calls of the captures it comes from, and
    `unmeasured` the groups every capture ran equally often but one left without any. `measured` holds the groups some capture gave a figure,
    `calls_by_group` each group's calls per capture, `least_measured_by_group` the
    fewest calls with a figure in any capture, and `largest_by_group` each group's
    largest sum.
    """

    figures_by_group: Dict[Hashable, GroupTotal]
    unmeasured: FrozenSet[Hashable]
    measured: FrozenSet[Hashable]
    calls_by_group: Dict[Hashable, Tuple[int, ...]]
    least_measured_by_group: Dict[Hashable, int]
    largest_by_group: Dict[Hashable, float]
    total: float

    @classmethod
    def of(cls, groups_by_capture: List[Dict[Hashable, GroupTotal]]) -> "Side":
        keys = list(
            dict.fromkeys(key for groups in groups_by_capture for key in groups)
        )
        calls = {
            key: tuple(
                groups[key].count if key in groups else 0
                for groups in groups_by_capture
            )
            for key in keys
        }
        least_measured = {
            key: min(
                groups[key].measured if key in groups else 0
                for groups in groups_by_capture
            )
            for key in keys
        }
        largest = {
            key: max(groups[key].total for groups in groups_by_capture if key in groups)
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
            totals = [groups[key] for groups in groups_by_capture]
            figures[key] = GroupTotal(
                median(group.total for group in totals),
                calls[key][0],
                _measured_behind_median(totals),
            )
        measured = frozenset(
            key
            for key in keys
            if any(
                groups[key].measured for groups in groups_by_capture if key in groups
            )
        )
        total = median(
            sum(group.total for group in groups.values())
            for groups in groups_by_capture
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
        counts = self.calls_by_group.get(key)
        return counts is not None and len(set(counts)) == 1

    def disagrees(self, key: Hashable) -> bool:
        """Whether the side's captures disagree on whether, or how often, it ran."""
        return key in self.calls_by_group and not self.ran(key)


def delta(before: float, after: float) -> float:
    """The move between two figures as the answer rounds them, so equal figures move
    by zero rather than by float noise, and never by a negative zero."""
    return round(round(after, 3) - round(before, 3), 3) + 0.0


@dataclass(frozen=True)
class Change:
    group: Hashable
    before: GroupTotal
    after: GroupTotal
    delta: float


@dataclass(frozen=True)
class Comparison:
    """Where each group a diff can say anything about goes, every list largest first."""

    changes: List[Change]
    within_threshold_count: int
    new: List[Hashable]
    missing: List[Hashable]
    unmeasured: List[Hashable]
    inconsistent: List[Hashable]


def _largest_first(size: float, group: Hashable) -> Tuple[float, str]:
    """The order of every list: largest first, then by group, so a tie reads the same
    in every answer."""
    return -size, str(group)


def classify(before: Side, after: Side, thresholds: Thresholds) -> Comparison:
    """Each group into exactly one list. A group no capture gives a figure, such as a
    host op's device time, is in none: the metric says nothing about it."""
    groups = [
        group
        for group in dict.fromkeys([*before.calls_by_group, *after.calls_by_group])
        if group in before.measured or group in after.measured
    ]
    changes: List[Change] = []
    within_threshold_count = 0
    new: List[Hashable] = []
    missing: List[Hashable] = []
    unmeasured: List[Hashable] = []
    inconsistent: List[Hashable] = []
    for group in groups:
        if before.disagrees(group) or after.disagrees(group):
            inconsistent.append(group)
        elif group not in before.calls_by_group:
            new.append(group)
        elif group not in after.calls_by_group:
            missing.append(group)
        elif group in before.unmeasured or group in after.unmeasured:
            unmeasured.append(group)
        else:
            was = before.figures_by_group[group]
            now = after.figures_by_group[group]
            move = delta(was.total, now.total)
            if thresholds.passes(was.total, move):
                changes.append(Change(group, was, now, move))
            else:
                within_threshold_count += 1

    def either_side(group: Hashable) -> float:
        return max(
            before.largest_by_group.get(group, 0.0),
            after.largest_by_group.get(group, 0.0),
        )

    def shown(side: Side, group: Hashable) -> float:
        # The figure the entry gives, so one outlier repeat can't carry it past the cap.
        figure = side.figures_by_group.get(group)
        return figure.total if figure is not None else side.largest_by_group[group]

    # Largest movement in either direction: a regression matters as much as a win.
    changes.sort(key=lambda change: _largest_first(abs(change.delta), change.group))
    new.sort(key=lambda group: _largest_first(shown(after, group), group))
    missing.sort(key=lambda group: _largest_first(shown(before, group), group))
    unmeasured.sort(key=lambda group: _largest_first(either_side(group), group))
    inconsistent.sort(key=lambda group: _largest_first(either_side(group), group))
    return Comparison(
        changes, within_threshold_count, new, missing, unmeasured, inconsistent
    )


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


def _listed(facts: List[str], conjunction: str) -> str:
    if len(facts) == 1:
        return facts[0]
    return f"{', '.join(facts[:-1])} {conjunction} {facts[-1]}"


def mismatch_caveat(mismatched: Dict[str, Dict[str, object]]) -> str:
    """The facts the captures differ in, named rather than quoted: the values are the
    captures' own text, and `mismatched` gives them by handle."""
    sentences = []
    hardware = [fact for fact in HARDWARE_FACTS if fact in mismatched]
    if hardware:
        sentences.append(
            f"The captures differ in {_listed(hardware, 'and')}, given by handle under "
            "mismatched, so every delta measures that difference as well as any change "
            "in the code."
        )
    if TENSOR_SIZES in mismatched:
        sentences.append(
            "The captures record tensor sizes differently, given by handle under "
            "mismatched, so a tile-padded tensor's signature differs between them and "
            "its ops land under new and missing."
        )
    return " ".join(sentences)


def unverified_caveat(unverified: Dict[str, List[str]]) -> str:
    """The facts only some captures record, which the diff could not compare."""
    return (
        f"Some captures record no {_listed(list(unverified), 'or')}, listed by fact "
        "under unverified, so whether they match the others there is unknown."
    )


__all__ = [
    "COMPARED_FACTS",
    "DEFAULT_MIN_PERCENT",
    "DIFF_MATCHES",
    "DIFF_METRICS",
    "DIFF_NOTE",
    "HARDWARE_FACTS",
    "MAX_CAPTURES_PER_SIDE",
    "MAX_SIGNATURE_CHARS",
    "SIGNATURE_NOISE_CAVEAT",
    "TENSOR_SIZES",
    "CaptureTotals",
    "Change",
    "Comparison",
    "DiffMatch",
    "DiffMetric",
    "GroupTotal",
    "Side",
    "Thresholds",
    "capture_totals",
    "classify",
    "delta",
    "group_fields",
    "mismatch_caveat",
    "side_handles",
    "threshold",
    "unverified_caveat",
]
