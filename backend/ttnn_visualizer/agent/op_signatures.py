# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""What an operation was called on: each input and output tensor's shape, layout,
dtype and memory, from the performance CSV's `INPUT_n_*` and `OUTPUT_n_*` columns.

Read apart from the generated report, which carries none of these columns, and only for
a tool that matches on them: `diff_reports` with `match: signature` (#2155).
"""

import csv
import re
import sys
from dataclasses import dataclass
from operator import itemgetter
from typing import Dict, List, Optional, Sequence, TextIO, Tuple

from ttnn_visualizer.exceptions import DataFormatError

# `INPUT_0_W` in older captures, `INPUT_0_W_PAD[LOGICAL]` in newer ones.
_TENSOR_COLUMN = re.compile(
    r"(INPUT|OUTPUT)_(\d+)_(W|Z|Y|X|LAYOUT|DATATYPE|MEMORY)(?:_PAD\[LOGICAL\])?"
)
_LOGICAL_SIZE = "_PAD[LOGICAL]"
_DIMENSIONS = ("W", "Z", "Y", "X")
_LABELS = {"INPUT": "in", "OUTPUT": "out"}
# A dimension whose padded and logical sizes agree, `384[384]`, reads as `384`.
_UNPADDED_DIMENSION = re.compile(r"(\d+)\[\1\]")
# `DEV_1_L1_INTERLEAVED` names its device, and a mesh's copies of one op must match.
_DEVICE_PREFIX = re.compile(r"^DEV_\d+_")


@dataclass(frozen=True)
class _Slot:
    """One tensor position, `in0` or `out1`, and the columns describing it."""

    label: str
    dimensions: Tuple[int, ...]
    layout: Optional[int]
    datatype: Optional[int]
    memory: Optional[int]

    @property
    def columns(self) -> Tuple[int, ...]:
        named = (self.layout, self.datatype, self.memory)
        return self.dimensions + tuple(index for index in named if index is not None)


def _slots(header: Sequence[str]) -> List[_Slot]:
    """The header's tensor positions, inputs then outputs, each in index order."""
    columns_by_slot: Dict[Tuple[str, int], Dict[str, int]] = {}
    for index, name in enumerate(header):
        found = _TENSOR_COLUMN.fullmatch(name.strip())
        if found:
            fields = columns_by_slot.setdefault((found[1], int(found[2])), {})
            fields.setdefault(found[3], index)

    slots = []
    for kind, position in sorted(
        columns_by_slot, key=lambda slot: (slot[0] != "INPUT", slot[1])
    ):
        fields = columns_by_slot[(kind, position)]
        slots.append(
            _Slot(
                label=f"{_LABELS[kind]}{position}",
                dimensions=tuple(
                    fields[name] for name in _DIMENSIONS if name in fields
                ),
                layout=fields.get("LAYOUT"),
                datatype=fields.get("DATATYPE"),
                memory=fields.get("MEMORY"),
            )
        )
    return slots


def _cell(row: Sequence[str], index: Optional[int]) -> str:
    return row[index].strip() if index is not None and index < len(row) else ""


def _dimension(cell: str) -> str:
    unpadded = _UNPADDED_DIMENSION.fullmatch(cell)
    return unpadded[1] if unpadded else cell


def _tensor(row: Sequence[str], slot: _Slot) -> str:
    """`8x1x384x768 TILE BFLOAT8_B L1_BLOCK_SHARDED`, or "" for an unused position."""
    shape = "x".join(
        dimension
        for dimension in (_dimension(_cell(row, index)) for index in slot.dimensions)
        if dimension
    )
    memory = _DEVICE_PREFIX.sub("", _cell(row, slot.memory), count=1)
    parts = (shape, _cell(row, slot.layout), _cell(row, slot.datatype), memory)
    return " ".join(part for part in parts if part)


def _signature(row: Sequence[str], slots: Sequence[_Slot]) -> Optional[str]:
    """`in0 … ; in1 … ; out0 …`, or None for a row with no tensor recorded."""
    tensors = []
    for slot in slots:
        tensor = _tensor(row, slot)
        if tensor:
            tensors.append(f"{slot.label} {tensor}")
    # Interned: a model repeats each signature once per layer.
    return sys.intern("; ".join(tensors)) if tensors else None


def _is_blank(row: Sequence[str]) -> bool:
    """A line pandas skips, which tt-perf-report's row ids therefore do not count."""
    return not row or (len(row) == 1 and not row[0].strip(" \t"))


@dataclass(frozen=True)
class Signatures:
    """Each data row's signature by its position, and whether the header records sizes
    as `padded[logical]`; older captures record a tile-padded size alone."""

    by_position: List[Optional[str]]
    logical_sizes: bool


def read_signatures(source: TextIO) -> Optional[Signatures]:
    """Each data row's signature by its position in the file, or None when the header
    names no tensor column.

    Positions count rows as tt-perf-report's pandas read does, which numbers a report
    row's id: an empty or whitespace-only line is no row.
    """
    reader = csv.reader(source)
    try:
        header = next(reader, [])
        slots = _slots(header)
        if not slots:
            return None
        cells_of = itemgetter(*sorted({i for slot in slots for i in slot.columns}))
        # A wide header has hundreds of tensor cells and a report a few dozen
        # distinct signatures, so each is built once per distinct set of cells.
        signature_by_cells: Dict[object, Optional[str]] = {}
        signatures: List[Optional[str]] = []
        for row in reader:
            if _is_blank(row):
                continue
            try:
                cells = cells_of(row)
            except IndexError:
                signatures.append(_signature(row, slots))
                continue
            if cells not in signature_by_cells:
                signature_by_cells[cells] = _signature(row, slots)
            signatures.append(signature_by_cells[cells])
        return Signatures(signatures, any(_LOGICAL_SIZE in name for name in header))
    except (csv.Error, UnicodeDecodeError) as error:
        raise DataFormatError(
            f"the performance CSV could not be read: {error}"
        ) from error


__all__ = ["Signatures", "read_signatures"]
