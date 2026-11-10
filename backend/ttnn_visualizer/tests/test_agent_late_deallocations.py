# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The `late_deallocations` port and tool, read from a report database. #2156

`test_agent_late_deallocation_parity.py` holds the port's maps and run starts to the app;
these hold `holds`, which goes past the app, and what the tool reads around the port and
says.
"""

import json
import sqlite3
from pathlib import Path
from typing import Dict, Iterator, List, Mapping, Optional, Sequence, Tuple, cast
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import failures
from ttnn_visualizer.agent import late_deallocations as late
from ttnn_visualizer.agent.bounds import MAX_DETAILED_LIMIT
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.agent.operations import BUFFER_SIZE_UNIT
from ttnn_visualizer.models import BufferType, Tensor
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.tests.mcp_calls import tool_call
from ttnn_visualizer.tests.memory_report_db import load_memory_report
from ttnn_visualizer.tests.test_agent_perf_detail import ANSWER_BUDGET_BYTES

L1 = BufferType.L1.value
DRAM = BufferType.DRAM.value

_TABLES = {
    "operations": "operation_id int, name text, duration float",
    "buffers": (
        "operation_id int, device_id int, address int, max_size_per_bank int, "
        "buffer_type int, buffer_layout int"
    ),
    "tensors": (
        "tensor_id int, shape text, dtype text, layout text, memory_config text, "
        "device_id int, address int, buffer_type int"
    ),
    "input_tensors": "operation_id int, input_index int, tensor_id int",
    "output_tensors": "operation_id int, output_index int, tensor_id int",
    "devices": "device_id int, worker_l1_size int, l1_num_banks int",
    "stack_traces": "operation_id int, stack_trace text",
}


def _tensor(tensor_id: int, address: Optional[int]) -> Tensor:
    return Tensor(
        tensor_id, "Shape([1, 32])", "BFLOAT16", "TILE", None, 0, address, None, []
    )


def _entry(
    tensor_id: int, last_use: int, size: int = 10, address: int = 100
) -> late.HeldTensor:
    return late.HeldTensor(tensor_id, address, size, last_use)


def _held_tensors(
    operation_ids: Sequence[int],
    sizes: Mapping[int, Dict[int, int]],
    inputs: Optional[Mapping[int, Sequence[Tuple[int, Optional[int]]]]] = None,
    outputs: Optional[Mapping[int, Sequence[Tuple[int, Optional[int]]]]] = None,
    consumers: Optional[Mapping[int, Sequence[int]]] = None,
    names: Optional[Mapping[int, str]] = None,
) -> late.HeldTensors:
    def tensors(by_operation):
        return {
            op: [_tensor(*tensor) for tensor in rows]
            for op, rows in (by_operation or {}).items()
        }

    return late.held_tensors_by_operation(
        operation_ids,
        tensors(inputs),
        tensors(outputs),
        [sizes.get(operation_id, {}) for operation_id in operation_ids],
        consumers or {},
        names or {},
    )


def _holds(
    operation_ids: Sequence[int],
    held: Mapping[int, Sequence[late.HeldTensor]],
    buffered: Optional[Sequence[int]] = None,
    deallocations: Optional[Mapping[int, Sequence[int]]] = None,
) -> List[late.Hold]:
    return late.holds(
        operation_ids,
        held,
        set(operation_ids if buffered is None else buffered),
        deallocations or {},
    )


def _span(hold: late.Hold) -> Tuple:
    return (
        hold.tensor_id,
        hold.first_operation_id,
        hold.last_operation_id,
        hold.ending,
        hold.deallocated_at,
    )


class TestBufferSizesByOperation:
    def test_the_largest_size_at_an_address_wins_where_it_was_first_seen(self):
        rows = [(1, 200, 10), (1, 100, 5), (1, 200, 30), (1, 200, 20), (1, 100, 5)]

        (sizes,) = late.buffer_sizes_by_operation([1], rows)

        assert list(sizes.items()) == [(200, 30), (100, 5)]

    def test_a_buffer_without_an_address_is_skipped(self):
        rows = [(1, 0, 10), (1, None, 20), (1, 100, 30)]

        assert list(late.buffer_sizes_by_operation([1], rows)) == [{100: 30}]

    def test_an_operation_without_rows_reads_empty(self):
        sizes = late.buffer_sizes_by_operation([1, 2, 3], [(2, 100, 10)])

        assert list(sizes) == [{}, {100: 10}, {}]

    def test_rows_for_operations_not_listed_are_skipped(self):
        rows = [
            (None, 100, 1),
            (1, 100, 10),
            (2, 100, 20),
            (3, 100, 30),
            (4, 100, 40),
            (5, 100, 50),
        ]

        assert list(late.buffer_sizes_by_operation([2, 4], rows)) == [
            {100: 20},
            {100: 40},
        ]

    def test_a_text_operation_id_and_size_are_read_as_numbers(self):
        rows = [("2", 100, "64"), ("2", 200, None)]

        assert list(late.buffer_sizes_by_operation([1, 2], rows)) == [
            {},
            {100: 64, 200: 0},
        ]

    def test_one_operations_rows_are_read_at_a_time(self):
        consumed: List[Tuple] = []

        def rows() -> Iterator[Tuple]:
            for row in [(1, 100, 1), (1, 200, 2), (2, 100, 3), (2, 200, 4)]:
                consumed.append(row)
                yield row

        sizes = late.buffer_sizes_by_operation([1, 2], rows())

        assert next(sizes) == {100: 1, 200: 2}
        # Operation 2's first row is read to see where operation 1's end.
        assert consumed == [(1, 100, 1), (1, 200, 2), (2, 100, 3)]


class TestHeldTensorsByOperation:
    def test_the_last_tensor_seen_at_an_address_holds_its_buffer(self):
        """Outputs after inputs, and a later operation after an earlier one."""
        held = _held_tensors(
            [1, 2, 3, 4],
            {2: {100: 64}, 4: {200: 8}},
            inputs={1: [(10, 100)]},
            outputs={1: [(11, 100)], 2: [(12, 200)], 3: [(13, 200)]},
            consumers={10: [1], 11: [1], 12: [2], 13: [3]},
        )

        assert held.held_by_operation == {
            2: [late.HeldTensor(11, 100, 64, 1)],
            4: [late.HeldTensor(13, 200, 8, 3)],
        }

    def test_a_tensor_at_address_0_is_seen(self):
        held = _held_tensors(
            [1, 2], {2: {0: 64}}, outputs={1: [(10, 0)]}, consumers={10: [1]}
        )

        assert held.held_by_operation == {2: [late.HeldTensor(10, 0, 64, 1)]}

    @pytest.mark.parametrize(
        "consumers",
        [
            pytest.param({}, id="no-consumer-row"),
            pytest.param({10: []}, id="no-consumers"),
            pytest.param({10: [2]}, id="only-deallocates"),
            pytest.param({10: [3]}, id="last-use-at-the-operation"),
            pytest.param({10: [4]}, id="last-use-after-the-operation"),
        ],
    )
    def test_a_tensor_with_no_last_use_before_the_operation_is_not_held(
        self, consumers
    ):
        held = _held_tensors(
            [1, 2, 3, 4],
            {3: {100: 64}},
            outputs={1: [(10, 100)]},
            consumers=consumers,
            names={2: "ttnn.deallocate", 3: "ttnn.add", 4: "ttnn.add"},
        )

        assert held.held_by_operation == {}

    def test_an_operation_with_any_buffer_is_buffered(self):
        held = _held_tensors([1, 2, 3], {1: {100: 64}, 3: {200: 0}})

        assert (held.held_by_operation, held.buffered_operation_ids) == ({}, {1, 3})

    def test_a_tensors_last_use_is_resolved_once(self):
        with patch.object(
            late, "last_valid_consumer", wraps=late.last_valid_consumer
        ) as resolve:
            held = _held_tensors(
                [1, 2, 3, 4, 5],
                {operation_id: {100: 64} for operation_id in (3, 4, 5)},
                outputs={1: [(10, 100)]},
                consumers={10: [2]},
            )

        assert sorted(held.held_by_operation) == [3, 4, 5]
        resolve.assert_called_once()


class TestRunStartCount:
    def test_an_operation_holding_nothing_ends_every_run(self):
        held = {1: [_entry(10, 0)], 2: [_entry(10, 0)], 3: [], 5: [_entry(10, 0)]}

        assert late.run_start_count([1, 2, 3, 4, 5], held) == 2

    def test_a_tensor_that_drops_out_and_comes_back_starts_again(self):
        held = {
            1: [_entry(10, 0), _entry(11, 0, address=200)],
            2: [_entry(10, 0)],
            3: [_entry(10, 0), _entry(11, 0, address=200)],
        }

        assert late.run_start_count([1, 2, 3], held) == 2

    def test_tensors_starting_on_one_operation_count_once(self):
        held = {
            1: [_entry(10, 0), _entry(11, 0, address=200), _entry(12, 0, address=300)]
        }

        assert late.run_start_count([1], held) == 1

    def test_a_run_is_one_tensor_at_one_address(self):
        held = {1: [_entry(10, 0)], 2: [_entry(10, 0, address=200)]}

        assert late.run_start_count([1, 2], held) == 2


class TestHolds:
    def test_a_hold_carries_across_an_operation_without_buffers(self):
        (hold,) = _holds(
            [1, 2, 3, 4],
            {2: [_entry(10, 1, size=10)], 4: [_entry(10, 1, size=30)]},
            buffered=[1, 2, 4],
        )

        assert (hold.first_operation_id, hold.last_operation_id) == (2, 4)
        assert (hold.operations_held, hold.bytes_per_bank, hold.byte_operations) == (
            2,
            30,
            40,
        )
        assert (hold.bridged, hold.attributed) == (True, True)

    def test_only_a_hold_that_was_open_across_the_gap_is_bridged(self):
        first, second = _holds(
            [1, 2, 3, 4, 5],
            {
                2: [_entry(10, 1)],
                4: [_entry(10, 1), _entry(11, 3, address=200)],
                5: [_entry(11, 3, address=200)],
            },
            buffered=[1, 2, 4, 5],
        )

        assert (first.tensor_id, first.bridged) == (10, True)
        assert (second.tensor_id, second.bridged, second.operations_held) == (
            11,
            False,
            2,
        )

    def test_a_deallocate_at_the_next_buffered_operation_ends_it(self):
        (hold,) = _holds(
            [1, 2, 3, 4],
            {2: [_entry(10, 1)], 3: [_entry(10, 1)]},
            deallocations={10: [4]},
        )

        assert _span(hold) == (10, 2, 3, late.Ending.DEALLOCATED, 4)

    def test_a_deallocate_between_buffered_operations_ends_it(self):
        (hold,) = _holds(
            [1, 2, 3, 4, 5],
            {2: [_entry(10, 1)], 3: [_entry(10, 1)]},
            buffered=[1, 2, 3, 5],
            deallocations={10: [4]},
        )

        assert _span(hold) == (10, 2, 3, late.Ending.DEALLOCATED, 4)

    def test_a_deallocate_whose_own_snapshot_still_shows_the_buffer_ends_it(self):
        (hold,) = _holds(
            [1, 2, 3, 4],
            {2: [_entry(10, 1)], 3: [_entry(10, 1)]},
            deallocations={10: [3]},
        )

        assert _span(hold) == (10, 2, 3, late.Ending.DEALLOCATED, 3)

    def test_a_buffer_gone_without_a_deallocate_was_freed_otherwise(self):
        (hold,) = _holds([1, 2, 3], {2: [_entry(10, 1)]})

        assert _span(hold) == (10, 2, 2, late.Ending.FREED_OTHERWISE, None)

    def test_a_hold_open_when_the_capture_ends_is_held_to_end(self):
        (hold,) = _holds([1, 2, 3], {2: [_entry(10, 1)], 3: [_entry(10, 1)]})

        assert _span(hold) == (10, 2, 3, late.Ending.HELD_TO_END, None)

    def test_a_deallocate_after_the_last_buffered_operation_ends_it(self):
        (hold,) = _holds(
            [1, 2, 3, 4],
            {2: [_entry(10, 1)], 3: [_entry(10, 1)]},
            buffered=[1, 2, 3],
            deallocations={10: [4]},
        )

        assert _span(hold) == (10, 2, 3, late.Ending.DEALLOCATED, 4)

    def test_the_first_deallocate_the_hold_did_not_outlive_is_named(self):
        (hold,) = _holds(
            [1, 2, 3, 4, 5, 6],
            {2: [_entry(10, 1)], 3: [_entry(10, 1)]},
            buffered=[1, 2, 3, 6],
            deallocations={10: [2, 4, 5]},
        )

        assert _span(hold) == (10, 2, 3, late.Ending.DEALLOCATED, 4)

    def test_the_first_hold_after_the_last_use_is_attributed(self):
        """Even past an operation that recorded no buffers."""
        (hold,) = _holds([1, 2, 3], {3: [_entry(10, 1)]}, buffered=[1, 3])

        assert hold.attributed

    def test_a_hold_opening_after_its_buffer_left_a_snapshot_is_unattributed(self):
        first, second = _holds([1, 2, 3, 4], {2: [_entry(10, 1)], 4: [_entry(10, 1)]})
        (late_start,) = _holds([1, 2, 3], {3: [_entry(10, 1)]})

        assert (first.attributed, second.attributed) == (True, False)
        assert not late_start.attributed

    def test_a_hold_opening_after_its_deallocate_is_unattributed(self):
        (hold,) = _holds(
            [1, 2, 3, 4],
            {3: [_entry(10, 1)], 4: [_entry(10, 1)]},
            buffered=[1, 3, 4],
            deallocations={10: [2]},
        )

        assert not hold.attributed
        assert _span(hold) == (10, 3, 4, late.Ending.HELD_TO_END, None)


class TestDeallocateNames:
    @pytest.mark.parametrize(
        "name", ["ttnn.deallocate", "TTNN.Deallocate", "ttnn::DEALLOCATE"]
    )
    def test_a_deallocate_is_named_in_any_case(self, name):
        assert late.is_deallocate(name)

    @pytest.mark.parametrize("name", [None, 3, b"ttnn.deallocate", "ttnn.add"])
    def test_a_null_or_non_text_name_is_not_a_deallocate(self, name):
        assert not late.is_deallocate(name)

    def test_the_last_valid_consumer_skips_deallocates_in_any_order(self):
        names = {2: "ttnn.add", 5: "ttnn.matmul", 9: "TTNN.DEALLOCATE"}

        assert late.last_valid_consumer([5, 9, 2], names) == 5

    def test_a_consumer_with_a_null_or_unknown_name_counts(self):
        names = cast(Dict[int, str], {3: None})

        assert late.last_valid_consumer([3, 4], names) == 4
        assert late.last_valid_consumer([3], {3: "ttnn.deallocate"}) == -1

    def test_each_tensors_deallocate_calls_are_listed_in_order(self):
        names = {2: "ttnn.deallocate", 3: "ttnn.add", 5: "ttnn::deallocate"}

        assert late.deallocations_by_tensor_id({10: [5, 3, 2], 11: [3]}, names) == {
            10: [2, 5]
        }


def _rows(
    operations: Sequence[Tuple[int, Optional[str]]],
    tensors: Sequence[Tuple[int, Optional[int]]] = (),
    inputs: Sequence[Tuple[int, int]] = (),
    outputs: Sequence[Tuple[int, int]] = (),
    buffers: Sequence[Tuple] = (),
    traces: Sequence[Tuple[int, Optional[str]]] = (),
    devices: Sequence[int] = (0,),
) -> Dict[str, List[Tuple]]:
    """Each table's rows: tensors as (id, address), inputs and outputs as (operation,
    tensor), buffers as `_snapshot` writes them."""
    return {
        "operations": [(operation_id, name, 1.0) for operation_id, name in operations],
        "tensors": [
            (tensor_id, "Shape([1, 32])", "BFLOAT16", "TILE", None, 0, address, L1)
            for tensor_id, address in tensors
        ],
        "input_tensors": [
            (op, index, tensor) for index, (op, tensor) in enumerate(inputs)
        ],
        "output_tensors": [
            (op, index, tensor) for index, (op, tensor) in enumerate(outputs)
        ],
        "buffers": [(*row, 0) for row in buffers],
        "devices": [(device_id, 1499136, 64) for device_id in devices],
        "stack_traces": list(traces),
    }


def _load(
    tmp_path: Path,
    rows_by_rank: Mapping[Optional[int], Dict[str, List[Tuple]]],
    stack_traces_table: bool = True,
) -> Tuple[ReportRegistry, str]:
    """A report of `rows_by_rank`; under `None`, one with no rank column."""
    tables = [name for name in _TABLES if stack_traces_table or name != "stack_traces"]
    rank_column = "" if None in rows_by_rank else "rank int, "
    return load_memory_report(
        tmp_path,
        "".join(
            f"CREATE TABLE {table} ({rank_column}{_TABLES[table]});" for table in tables
        ),
        (
            (table, row if rank is None else (rank, *row))
            for rank, rows_by_table in rows_by_rank.items()
            for table in tables
            for row in rows_by_table[table]
        ),
    )


def _report(
    tmp_path: Path, rows: Dict[str, List[Tuple]], stack_traces_table: bool = True
) -> Tuple[ReportRegistry, str]:
    return _load(tmp_path, {None: rows}, stack_traces_table)


def _snapshot(
    operation_id: int, sizes: Dict[int, int], buffer_type: object = L1, device: int = 0
) -> List[Tuple]:
    return [
        (operation_id, device, address, size, buffer_type)
        for address, size in sizes.items()
    ]


def _trace(
    file: str,
    line: object,
    function: str = "forward",
    code: str = "y = ttnn.matmul(a, b)",
    caller: str = "/m/main.py",
) -> str:
    return (
        f'  File "{file}", line {line}, in {function}\n    {code}\n\n'
        f'  File "{caller}", line 1, in <module>\n    run()\n'
    )


def _three_holds(
    tmp_path: Path, buffers: Optional[Sequence[Tuple]] = None
) -> Tuple[ReportRegistry, str]:
    """Tensor 10 deallocated at 4, 11 held to the end, 12 freed with no deallocate.

    10 and 11 are last used by the matmul at operation 2, 12 by the add at 3.
    """
    snapshots = [
        *_snapshot(1, {1000: 100, 2000: 200}),
        *_snapshot(2, {1000: 100, 2000: 200, 3000: 300}),
        *_snapshot(3, {1000: 100, 2000: 200, 3000: 300, 4000: 400}),
        *_snapshot(4, {2000: 200, 3000: 300, 4000: 400}),
        *_snapshot(5, {2000: 200, 4000: 400}),
    ]
    rows = _rows(
        operations=[
            (1, "ttnn.from_torch"),
            (2, "ttnn.matmul"),
            (3, "ttnn.add"),
            (4, "ttnn.deallocate"),
            (5, "ttnn.relu"),
        ],
        tensors=[(10, 1000), (11, 2000), (12, 3000), (13, 4000)],
        inputs=[(2, 10), (2, 11), (3, 12), (4, 10), (5, 13)],
        outputs=[(1, 10), (1, 11), (2, 12), (3, 13)],
        buffers=snapshots if buffers is None else buffers,
        traces=[
            (2, _trace("/m/model.py", 10)),
            (3, _trace("/m/model.py", 20, code="z = ttnn.add(y, b)")),
        ],
    )
    return _report(tmp_path, rows)


def _l1_and_dram(tmp_path: Path) -> Tuple[ReportRegistry, str]:
    """Tensor 10 held in L1 at operation 3, and tensor 20 in DRAM at 3 and 4."""
    rows = _rows(
        operations=[
            (1, "ttnn.from_torch"),
            (2, "ttnn.matmul"),
            (3, "ttnn.add"),
            (4, "ttnn.add"),
        ],
        tensors=[(10, 1000), (20, 5000)],
        inputs=[(2, 10), (2, 20)],
        outputs=[(1, 10), (1, 20)],
        buffers=[
            *_snapshot(3, {1000: 100}),
            *_snapshot(3, {5000: 500}, DRAM),
            *_snapshot(4, {5000: 500}, DRAM),
        ],
    )
    return _report(tmp_path, rows)


def _held_once(
    tmp_path: Path, uses: Sequence[Tuple[int, Optional[str], str]]
) -> Tuple[ReportRegistry, str]:
    """One tensor per (size, trace, name) of an operation that last uses it, each held
    at one final operation."""
    count = len(uses)
    final = 2 + count
    operations: List[Tuple[int, Optional[str]]] = [(1, "ttnn.from_torch")]
    traces = []
    for index, (_, trace, name) in enumerate(uses):
        operations.append((2 + index, name))
        if trace is not None:
            traces.append((2 + index, trace))
    operations.append((final, "ttnn.add"))
    rows = _rows(
        operations=operations,
        tensors=[(100 + index, 1000 * (index + 1)) for index in range(count)],
        inputs=[(2 + index, 100 + index) for index in range(count)],
        outputs=[(1, 100 + index) for index in range(count)],
        buffers=_snapshot(
            final,
            {1000 * (index + 1): size for index, (size, _, _) in enumerate(uses)},
        ),
        traces=traces,
    )
    return _report(tmp_path, rows)


def _many_call_sites(
    tmp_path: Path, sites: int, uses: int = 1, text: int = 10, line_digits: int = 0
) -> Tuple[ReportRegistry, str]:
    """`sites` call sites of `uses` last uses each, with file, function, code and
    operation names `text` characters long."""
    last_uses: List[Tuple[int, Optional[str], str]] = []
    for site in range(sites):
        line = int(f"{site + 1}{'9' * line_digits}")
        trace = _trace(
            f"/m/{'f' * text}.py",
            line,
            function="g" * text,
            code=f"y = ttnn.matmul({'a' * text})",
        )
        for use in range(uses):
            index = site * uses + use
            last_uses.append((index + 1, trace, f"ttnn.op{index:04d}{'n' * text}"))
    return _held_once(tmp_path, last_uses)


class TestTheAnswer:
    def test_it_answers_with_every_hold_its_ending_and_call_site(self, tmp_path):
        registry, handle = _three_holds(tmp_path)

        result = failures.late_deallocations(registry, handle)

        # `top_holds` is the next test's.
        assert {key: result[key] for key in result if key != "top_holds"} == {
            "handle": handle,
            "buffer_type": "L1",
            "size_unit": BUFFER_SIZE_UNIT,
            "operation_count": 5,
            "run_start_count": 2,
            "hold_count": 3,
            "held_tensor_count": 3,
            "unattributed_hold_count": 0,
            "ended": {"deallocated": 1, "freed_otherwise": 1, "held_to_end": 1},
            "byte_operations": 1000,
            "call_site_count": 2,
            "returned": 2,
            "call_sites": [
                {
                    "call_site": {
                        "file": "/m/model.py",
                        "line": 10,
                        "function": "forward",
                        "code": "y = ttnn.matmul(a, b)",
                    },
                    "hold_count": 2,
                    "held_tensor_count": 2,
                    "ended": {"deallocated": 1, "freed_otherwise": 0, "held_to_end": 1},
                    "byte_operations": 700,
                    "largest_bytes_per_bank": 200,
                    "longest_hold_operations": 3,
                    "last_use_operation_ids": [2],
                    "last_use_operation_count": 1,
                    "last_use_operation_names": ["ttnn.matmul"],
                },
                {
                    "call_site": {
                        "file": "/m/model.py",
                        "line": 20,
                        "function": "forward",
                        "code": "z = ttnn.add(y, b)",
                    },
                    "hold_count": 1,
                    "held_tensor_count": 1,
                    "ended": {"deallocated": 0, "freed_otherwise": 1, "held_to_end": 0},
                    "byte_operations": 300,
                    "largest_bytes_per_bank": 300,
                    "longest_hold_operations": 1,
                    "last_use_operation_ids": [3],
                    "last_use_operation_count": 1,
                    "last_use_operation_names": ["ttnn.add"],
                },
            ],
            "note": failures.LATE_DEALLOCATIONS_NOTE,
            "multi_host": False,
            "rank": None,
        }

    def test_the_largest_holds_are_listed_with_how_each_ended(self, tmp_path):
        registry, handle = _three_holds(tmp_path)

        top = failures.late_deallocations(registry, handle)["top_holds"]

        assert [(hold["tensor_id"], hold["ending"]) for hold in top] == [
            (11, "held_to_end"),
            (12, "freed_otherwise"),
            (10, "deallocated"),
        ]
        assert top[2] == {
            "tensor_id": 10,
            "address": 1000,
            "bytes_per_bank": 100,
            "operations_held": 1,
            "byte_operations": 100,
            "held_from_operation_id": 3,
            "held_until_operation_id": 3,
            "last_use_operation_id": 2,
            "last_use_operation_name": "ttnn.matmul",
            "last_use_location": "/m/model.py:10",
            "ending": "deallocated",
            "producer_operation_ids": [1],
            "deallocated_at_operation_id": 4,
        }
        assert "deallocated_at_operation_id" not in top[0]

    def test_each_listed_hold_names_the_operations_that_output_its_tensor(
        self, tmp_path
    ):
        """10 is output twice, 11 never, as a host tensor is, and 12 more times than
        are listed."""
        rows = _rows(
            operations=[(op, "ttnn.op") for op in range(1, 10)],
            tensors=[(10, 1000), (11, 2000), (12, 3000)],
            inputs=[(3, 10), (3, 11), (8, 12)],
            outputs=[(1, 10), (2, 10), *((op, 12) for op in range(1, 8))],
            buffers=_snapshot(9, {1000: 100, 2000: 200, 3000: 300}),
        )
        registry, handle = _report(tmp_path, rows)

        top = failures.late_deallocations(registry, handle)["top_holds"]

        assert [
            (
                hold["tensor_id"],
                hold["producer_operation_ids"],
                hold.get("producer_operation_count"),
            )
            for hold in top
        ] == [(12, [1, 2, 3, 4, 5], 7), (11, [], None), (10, [1, 2], None)]

    @pytest.mark.parametrize(
        ("buffer_type", "named", "tensor_id"),
        [
            (None, "L1", 10),
            ("", "L1", 10),
            ("l1", "L1", 10),
            (" dram ", "DRAM", 20),
            ("DRAM", "DRAM", 20),
        ],
    )
    def test_l1_is_read_unless_dram_is_asked_for(
        self, tmp_path, buffer_type, named, tensor_id
    ):
        registry, handle = _l1_and_dram(tmp_path)

        result = failures.late_deallocations(registry, handle, buffer_type=buffer_type)

        assert result["buffer_type"] == named
        assert [hold["tensor_id"] for hold in result["top_holds"]] == [tensor_id]

    def test_an_unknown_buffer_type_is_refused_with_the_choices(self, tmp_path):
        registry, handle = _l1_and_dram(tmp_path)

        with pytest.raises(
            ValueError, match="unknown buffer_type 'SRAM'; expected one of DRAM, L1"
        ):
            failures.late_deallocations(registry, handle, buffer_type="sram")

    def test_each_buffer_type_is_read_once_per_handle(self, tmp_path):
        registry, handle = _l1_and_dram(tmp_path)

        with patch.object(
            failures,
            "report_late_deallocations",
            wraps=failures.report_late_deallocations,
        ) as read:
            l1 = failures.late_deallocations(registry, handle)
            dram = failures.late_deallocations(registry, handle, buffer_type="DRAM")
            again = failures.late_deallocations(registry, handle, limit=1)
            failures.late_deallocations(registry, handle, buffer_type="DRAM")

        assert read.call_count == 2
        assert (l1["byte_operations"], dram["byte_operations"]) == (100, 1000)
        assert again["top_holds"] == l1["top_holds"]

    def test_a_two_rank_report_reads_the_rank_asked_for(self, tmp_path):
        def rank_rows(tensor_id: int, size: int) -> Dict[str, List[Tuple]]:
            return _rows(
                operations=[
                    (1, "ttnn.from_torch"),
                    (2, "ttnn.matmul"),
                    (3, "ttnn.add"),
                ],
                tensors=[(tensor_id, 1000)],
                inputs=[(2, tensor_id)],
                outputs=[(1, tensor_id)],
                buffers=_snapshot(3, {1000: size}),
                traces=[(2, _trace(f"/m/rank{tensor_id}.py", 10))],
            )

        registry, handle = _load(
            tmp_path, {0: rank_rows(10, 100), 1: rank_rows(20, 222)}
        )

        first = failures.late_deallocations(registry, handle)
        second = failures.late_deallocations(registry, handle, rank=1)

        assert (first["rank"], first["top_holds"][0]["tensor_id"]) == (0, 10)
        assert (second["rank"], second["multi_host"]) == (1, True)
        assert second["top_holds"][0]["tensor_id"] == 20
        assert second["byte_operations"] == 222
        assert second["call_sites"][0]["call_site"]["file"] == "/m/rank20.py"
        assert "multi-host report read at rank 1" in second["caveat"]


class TestCallSites:
    def test_holds_are_grouped_by_their_last_uses_frame_0_and_ranked_by_bytes(
        self, tmp_path
    ):
        """The outer frames differ, and the call site is still one."""
        registry, handle = _held_once(
            tmp_path,
            [
                (100, _trace("/m/model.py", 10, caller="/m/a.py"), "ttnn.matmul"),
                (200, _trace("/m/model.py", 10, caller="/m/b.py"), "ttnn.linear"),
                (1000, _trace("/m/model.py", 20), "ttnn.add"),
            ],
        )

        sites = failures.late_deallocations(registry, handle)["call_sites"]

        assert [
            (
                site["call_site"]["line"],
                site["byte_operations"],
                site["last_use_operation_ids"],
                site["last_use_operation_names"],
            )
            for site in sites
        ] == [
            (20, 1000, [4], ["ttnn.add"]),
            (10, 300, [2, 3], ["ttnn.linear", "ttnn.matmul"]),
        ]

    def test_a_hold_whose_last_use_has_no_trace_has_no_call_site(self, tmp_path):
        registry, handle = _held_once(
            tmp_path,
            [
                (100, _trace("/m/model.py", 10), "ttnn.matmul"),
                (200, None, "ttnn.add"),
                (300, "#0 0x7f in ttnn::run()", "ttnn.relu"),
            ],
        )

        result = failures.late_deallocations(registry, handle)

        none, placed = result["call_sites"]
        assert (none["call_site"], none["hold_count"]) == (None, 2)
        assert (placed["call_site"]["line"], placed["hold_count"]) == (10, 1)
        assert [hold["last_use_location"] for hold in result["top_holds"]] == [
            None,
            None,
            "/m/model.py:10",
        ]
        assert "2 of the 3 holds have no call site" in result["caveat"]

    @pytest.mark.parametrize("line", ["9" * 4301, 0])
    def test_a_line_number_no_file_has_is_no_call_site(self, tmp_path, line):
        """Past 4,300 digits Python's `int` refuses the line; line 0 is no line."""
        registry, handle = _held_once(
            tmp_path, [(100, _trace("/m/model.py", line), "ttnn.matmul")]
        )

        result = failures.late_deallocations(registry, handle)

        assert result["call_sites"][0]["call_site"] is None
        assert "1 of the 1 holds have no call site" in result["caveat"]

    def test_the_last_uses_past_one_read_of_traces_get_their_call_sites(self, tmp_path):
        count = failures._STACK_TRACE_IDS_PER_READ + 1
        uses = [
            (10, _trace("/m/model.py", index + 1), "ttnn.matmul")
            for index in range(count)
        ]
        # The highest last use, read in the second batch, holds the most.
        uses[-1] = (1000, _trace("/m/model.py", count), "ttnn.matmul")
        registry, handle = _held_once(tmp_path, uses)

        with patch.object(
            DatabaseQueries,
            "query_stack_traces",
            autospec=True,
            side_effect=DatabaseQueries.query_stack_traces,
        ) as read:
            result = failures.late_deallocations(registry, handle)

        assert read.call_count == 2
        assert result["call_site_count"] == count
        assert "no call site" not in result.get("caveat", "")
        assert (
            result["top_holds"][0]["last_use_operation_id"],
            result["top_holds"][0]["last_use_location"],
        ) == (count + 1, f"/m/model.py:{count}")

    def test_an_operation_with_two_traces_is_placed_by_its_first(self, tmp_path):
        rows = _rows(
            operations=[(1, "ttnn.from_torch"), (2, "ttnn.matmul"), (3, "ttnn.add")],
            tensors=[(10, 1000)],
            inputs=[(2, 10)],
            outputs=[(1, 10)],
            buffers=_snapshot(3, {1000: 100}),
            traces=[(2, _trace("/m/model.py", 10)), (2, _trace("/m/model.py", 20))],
        )
        registry, handle = _report(tmp_path, rows)

        (site,) = failures.late_deallocations(registry, handle)["call_sites"]

        assert site["call_site"]["line"] == 10

    def test_call_sites_holding_as_much_rank_by_file_and_line_then_none(self, tmp_path):
        registry, handle = _held_once(
            tmp_path,
            [
                (100, None, "ttnn.add"),
                (100, _trace("/m/model.py", 10), "ttnn.matmul"),
                (100, _trace("/m/a.py", 30), "ttnn.relu"),
            ],
        )

        sites = failures.late_deallocations(registry, handle)["call_sites"]

        assert [
            None if site["call_site"] is None else site["call_site"]["file"]
            for site in sites
        ] == ["/m/a.py", "/m/model.py", None]

    def test_a_report_without_stack_traces_answers_without_call_sites(self, tmp_path):
        rows = _rows(
            operations=[(1, "ttnn.from_torch"), (2, "ttnn.add"), (3, "ttnn.add")],
            tensors=[(10, 1000)],
            inputs=[(2, 10)],
            outputs=[(1, 10)],
            buffers=_snapshot(3, {1000: 100}),
        )
        registry, handle = _report(tmp_path, rows, stack_traces_table=False)

        result = failures.late_deallocations(registry, handle)

        assert [site["call_site"] for site in result["call_sites"]] == [None]
        assert "1 of the 1 holds have no call site" in result["caveat"]

    def test_long_text_is_cut_and_says_how_long_it_was(self, tmp_path):
        file = "/m/" + "f" * 400 + ".py"
        name = "ttnn." + "n" * 150
        trace = _trace(file, 10, function="g" * 400, code="c" * 400)
        registry, handle = _held_once(tmp_path, [(100, trace, name)])

        result = failures.late_deallocations(registry, handle)

        cap = failures.MAX_CALL_SITE_TEXT_CHARS
        site = result["call_sites"][0]
        assert site["call_site"] == {
            "file": file[:cap],
            "file_full_length": len(file),
            "line": 10,
            "function": "g" * cap,
            "function_full_length": 400,
            "code": "c" * cap,
            "code_full_length": 400,
        }
        assert site["last_use_operation_names"] == [
            name[: failures.MAX_OPERATION_NAME_CHARS]
        ]
        hold = result["top_holds"][0]
        assert (
            hold["last_use_operation_name"] == name[: failures.MAX_OPERATION_NAME_CHARS]
        )
        assert hold["last_use_operation_name_full_length"] == len(name)
        assert hold["last_use_location"] == f"{file[:cap]}:10"

    def test_a_call_site_lists_a_few_last_uses_and_counts_them_all(self, tmp_path):
        registry, handle = _many_call_sites(tmp_path, sites=1, uses=7)

        (site,) = failures.late_deallocations(registry, handle)["call_sites"]

        assert site["last_use_operation_ids"] == [2, 3, 4, 5, 6]
        assert site["last_use_operation_count"] == 7
        assert len(site["last_use_operation_names"]) == failures.MAX_LISTED_LAST_USES

    @pytest.mark.parametrize(
        ("limit", "returned"), [(None, 10), (1, 1), (100, MAX_DETAILED_LIMIT)]
    )
    def test_a_limit_caps_the_call_sites_and_not_the_largest_holds(
        self, tmp_path, limit, returned
    ):
        registry, handle = _many_call_sites(tmp_path, sites=MAX_DETAILED_LIMIT + 5)

        result = failures.late_deallocations(registry, handle, limit=limit)

        assert (result["call_site_count"], result["returned"]) == (
            MAX_DETAILED_LIMIT + 5,
            returned,
        )
        assert len(result["call_sites"]) == returned
        assert len(result["top_holds"]) == failures.MAX_LISTED_HOLDS


class TestCaveats:
    def test_a_report_with_no_buffers_of_the_type_says_so(self, tmp_path):
        registry, handle = _three_holds(tmp_path)

        result = failures.late_deallocations(registry, handle, buffer_type="DRAM")

        assert (result["hold_count"], result["run_start_count"]) == (0, 0)
        assert "records no DRAM buffers under the type's number" in result["caveat"]

    def test_a_report_storing_buffer_types_by_name_reads_none(self, tmp_path):
        """As the app reads it (#2196)."""
        registry, handle = _three_holds(
            tmp_path,
            buffers=[
                *_snapshot(3, {2000: 200}, "L1"),
                *_snapshot(4, {2000: 200}, "L1"),
            ],
        )

        result = failures.late_deallocations(registry, handle)

        assert result["hold_count"] == 0
        assert "records no L1 buffers under the type's number" in result["caveat"]

    def test_a_hold_on_a_later_tensors_buffer_is_left_out_and_counted(self, tmp_path):
        """The buffer leaves operation 4's snapshot and a buffer at its address is back
        at 5, with nothing naming the tensor it belongs to."""
        registry, handle = _report(
            tmp_path,
            _rows(
                operations=[(op, "ttnn.add") for op in range(1, 6)],
                tensors=[(10, 1000)],
                inputs=[(2, 10)],
                outputs=[(1, 10)],
                buffers=[
                    *_snapshot(3, {1000: 100}),
                    *_snapshot(4, {9000: 1}),
                    *_snapshot(5, {1000: 70}),
                ],
                traces=[(2, _trace("/m/model.py", 10))],
            ),
        )

        result = failures.late_deallocations(registry, handle)

        assert (result["hold_count"], result["unattributed_hold_count"]) == (1, 1)
        assert (result["byte_operations"], result["run_start_count"]) == (100, 2)
        assert result["ended"]["freed_otherwise"] == 1
        assert [hold["held_from_operation_id"] for hold in result["top_holds"]] == [3]
        assert "1 more holds, 70 byte_operations, are left out" in result["caveat"]

    def test_a_hold_across_an_operation_without_buffers_says_so(self, tmp_path):
        registry, handle = _report(
            tmp_path,
            _rows(
                operations=[(op, "ttnn.add") for op in range(1, 6)],
                tensors=[(10, 1000)],
                inputs=[(2, 10)],
                outputs=[(1, 10)],
                buffers=[*_snapshot(3, {1000: 100}), *_snapshot(5, {1000: 100})],
                traces=[(2, _trace("/m/model.py", 10))],
            ),
        )

        result = failures.late_deallocations(registry, handle)

        assert (result["hold_count"], result["run_start_count"]) == (1, 2)
        assert result["top_holds"][0]["operations_held"] == 2
        assert (
            "1 holds carry on past operations that recorded no L1 buffers at all, "
            "3 of the 5." in result["caveat"]
        )

    def test_only_a_listed_hold_is_counted_as_carried_on(self, tmp_path):
        """The one hold listed spans one operation; the unattributed one is bridged."""
        registry, handle = _report(
            tmp_path,
            _rows(
                operations=[(op, "ttnn.add") for op in range(1, 8)],
                tensors=[(10, 1000)],
                inputs=[(2, 10)],
                outputs=[(1, 10)],
                buffers=[
                    *_snapshot(3, {1000: 100}),
                    *_snapshot(4, {9000: 1}),
                    *_snapshot(5, {1000: 100}),
                    *_snapshot(7, {1000: 100}),
                ],
                traces=[(2, _trace("/m/model.py", 10))],
            ),
        )

        result = failures.late_deallocations(registry, handle)

        assert (result["hold_count"], result["unattributed_hold_count"]) == (1, 1)
        assert "carry on past operations" not in result["caveat"]

    def test_a_multi_device_report_reads_each_address_at_its_largest(self, tmp_path):
        registry, handle = _report(
            tmp_path,
            _rows(
                operations=[
                    (1, "ttnn.from_torch"),
                    (2, "ttnn.matmul"),
                    (3, "ttnn.add"),
                ],
                tensors=[(10, 1000)],
                inputs=[(2, 10)],
                outputs=[(1, 10)],
                buffers=[
                    *_snapshot(3, {1000: 100}, device=0),
                    *_snapshot(3, {1000: 150}, device=1),
                ],
                traces=[(2, _trace("/m/model.py", 10))],
                devices=[0, 1],
            ),
        )

        result = failures.late_deallocations(registry, handle)

        assert result["top_holds"][0]["bytes_per_bank"] == 150
        assert result["caveat"] == (
            "This report covers 2 devices. As Buffer Summary does, each address is "
            "read once across them, at its largest buffer."
        )


class TestAnswerSize:
    def _answer(self, registry: ReportRegistry, handle: str) -> str:
        result, _outcome = tool_call(
            registry, "late_deallocations", {"handle": handle, "limit": 100}
        )
        assert not result.get("isError")
        return result["content"][0]["text"]

    def test_the_most_a_call_can_list_stays_inside_the_budget(self, tmp_path):
        registry, handle = _many_call_sites(
            tmp_path, sites=MAX_DETAILED_LIMIT + 15, uses=6, text=1000
        )

        text = self._answer(registry, handle)

        assert len(text.encode()) < ANSWER_BUDGET_BYTES
        result = json.loads(text)
        assert len(result["call_sites"]) == MAX_DETAILED_LIMIT
        assert len(result["top_holds"]) == failures.MAX_LISTED_HOLDS
        assert all(
            len(site["last_use_operation_names"]) == failures.MAX_LISTED_LAST_USES
            for site in result["call_sites"]
        )

    def test_a_crafted_line_number_stays_inside_the_budget(self, tmp_path):
        registry, handle = _many_call_sites(
            tmp_path, sites=MAX_DETAILED_LIMIT, line_digits=4000
        )

        assert len(self._answer(registry, handle).encode()) < ANSWER_BUDGET_BYTES


class TestIterBufferSizes:
    def _queries(self, ranked: bool, rows: Sequence[Tuple]) -> DatabaseQueries:
        connection = sqlite3.connect(":memory:")
        rank_column = "rank int, " if ranked else ""
        connection.execute(f"CREATE TABLE buffers ({rank_column}{_TABLES['buffers']})")
        placeholders = ", ".join("?" * len(rows[0]))
        connection.executemany(f"INSERT INTO buffers VALUES ({placeholders})", rows)
        return DatabaseQueries(connection=connection)

    def test_it_streams_one_buffer_types_rows_in_operation_order(self):
        queries = self._queries(
            False,
            [
                (3, 0, 300, 30, L1, 0),
                (1, 0, 100, 10, L1, 0),
                (2, 0, 200, 20, DRAM, 0),
                (2, 0, 210, 21, "L1", 0),
                (1, 1, 110, 11, L1, 0),
            ],
        )

        rows = list(queries.iter_buffer_sizes(L1))

        assert [row[0] for row in rows] == [1, 1, 3]
        assert sorted(rows) == [(1, 100, 10), (1, 110, 11), (3, 300, 30)]

    def test_text_operation_ids_are_stored_and_read_as_numbers(self):
        """The column's integer affinity stores them as numbers, so "10" follows "2"."""
        queries = self._queries(
            False, [("10", 0, 100, 10, L1, 0), ("2", 0, 200, 20, L1, 0)]
        )

        assert list(queries.iter_buffer_sizes(L1)) == [(2, 200, 20), (10, 100, 10)]

    def test_a_rank_is_read_where_the_table_has_one(self):
        rows = [(0, 1, 0, 100, 10, L1, 0), (1, 1, 0, 200, 20, L1, 0)]
        queries = self._queries(True, rows)

        assert list(queries.iter_buffer_sizes(L1, rank=1)) == [(1, 200, 20)]
        assert sorted(queries.iter_buffer_sizes(L1)) == [(1, 100, 10), (1, 200, 20)]

    def test_a_rank_is_ignored_where_the_table_has_none(self):
        queries = self._queries(False, [(1, 0, 100, 10, L1, 0)])

        assert list(queries.iter_buffer_sizes(L1, rank=1)) == [(1, 100, 10)]
