# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`op_configurations`: calls grouped as tt-metal's model tracer groups them. #2156"""

import contextlib
import inspect
import json
import re
import sqlite3
import time
from pathlib import Path
from typing import List, Optional, Sequence, Tuple
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import linking
from ttnn_visualizer.agent import op_configurations as configurations
from ttnn_visualizer.agent import server, tools
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.agent.linking import LinkStatus, MatchedOn, OperationLink
from ttnn_visualizer.agent.operations import RankScope
from ttnn_visualizer.agent.tool_names import McpToolName
from ttnn_visualizer.tests.mcp_calls import tool_call
from ttnn_visualizer.tests.memory_report_db import load_memory_report

# A pytest fixture: tests take it by name from their signature, so nothing reads it here.
from ttnn_visualizer.tests.test_agent_linking import linked  # noqa: F401
from ttnn_visualizer.tests.test_agent_linking import (
    _GRAPHS,
    _graph,
    _perf_row,
    _write_profiler,
    _write_ranked_profiler,
)
from ttnn_visualizer.tests.test_agent_perf_detail import ANSWER_BUDGET_BYTES

_SCHEMA = """
CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);
CREATE TABLE operation_arguments (operation_id int, name text, value text);
"""

Call = Tuple[str, Sequence[Tuple[str, Optional[str]]]]

# As a local CCL capture writes a semaphore.
_SEMAPHORE = "<ttnn._ttnn.global_semaphore.global_semaphore object at 0x{:x}>"

# CPU time, which a loaded runner does not stretch as it does wall-clock time. Each crafted
# text reads in milliseconds, and took 52 s or more read quadratically.
_ONE_PASS_CPU_SECONDS = 5


def _tensor(
    shape: str = "[8, 384, 768]",
    tensor_id: int = 1,
    device_id: int = 1,
    memory_layout: str = "INTERLEAVED",
    layout: str = "TILE",
    buffer_type: str = "L1",
    dtype: str = "BFLOAT16",
) -> str:
    """A tensor argument as a current capture writes it."""
    return (
        f"ttnn.Tensor(shape=Shape({shape}), dtype=DataType.{dtype}, "
        f"layout=Layout.{layout}, memory_config=MemoryConfig(memory_layout="
        f"TensorMemoryLayout::{memory_layout},buffer_type=BufferType::{buffer_type},"
        "shard_spec=std::nullopt), storage_type=StorageType.DEVICE, "
        f"tensor_id={tensor_id}, is_allocated=True, device_id={device_id}, "
        "mesh_shape=MeshShape([1, 1]))"
    )


def _older_tensor(data: str, shape: str = "[4096, 1024]") -> str:
    """A tensor argument as older captures write it: its data ahead of its shape."""
    return (
        f"ttnn.Tensor([[ {data},  ...,  0.00365],\n             [ 0.00101,  ...]], "
        f"shape=Shape({shape}), dtype=DataType::BFLOAT16, layout=Layout::TILE)"
    )


def _capture(tmp_path: Path, calls: Sequence[Call]) -> Tuple[ReportRegistry, str]:
    """A memory report of `calls`, numbered from 1, each with its arguments in order."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    rows: List[Tuple[str, Sequence[object]]] = []
    for operation_id, (name, arguments) in enumerate(calls, start=1):
        rows.append(("operations", (operation_id, name, 0.1)))
        rows.extend(
            ("operation_arguments", (operation_id, argument, value))
            for argument, value in arguments
        )
    return load_memory_report(tmp_path, _SCHEMA, rows)


def _listing(tmp_path: Path, calls: Sequence[Call], **arguments) -> dict:
    registry, handle = _capture(tmp_path, calls)
    return linking.op_configurations(registry, handle, **arguments)


def _add_arguments(profiler_path: str, rows: Sequence[Tuple], ranked=False) -> None:
    connection = sqlite3.connect(Path(profiler_path) / "db.sqlite")
    try:
        rank = ", rank int NOT NULL DEFAULT 0" if ranked else ""
        connection.execute(
            f"CREATE TABLE operation_arguments (operation_id int, name text, "
            f"value text{rank})"
        )
        placeholders = ", ".join("?" * len(rows[0]))
        connection.executemany(
            f"INSERT INTO operation_arguments VALUES ({placeholders})", rows
        )
        connection.commit()
    finally:
        connection.close()


class TestNormalisation:
    def test_an_object_address_is_removed_as_the_tracer_strips_it(self):
        text = "<ttnn._ttnn.operations.core.WormholeComputeKernelConfig object at 0x7bbb6814b390>"

        assert (
            configurations.normalised_value(text)
            == "<ttnn._ttnn.operations.core.WormholeComputeKernelConfig object>"
        )

    def test_an_unset_allowed_worker_cores_is_removed_and_a_set_one_kept(self):
        unset = "MatmulProgramConfig(per_core_N=1,allowed_worker_cores=std::nullopt)"
        set_ = "MatmulProgramConfig(per_core_N=1,allowed_worker_cores={[(x=0,y=0)]})"

        assert configurations.normalised_value(unset) == (
            "MatmulProgramConfig(per_core_N=1)"
        )
        assert configurations.normalised_value(set_) == set_

    def test_a_tensors_ids_and_allocation_are_removed_and_its_config_kept(self):
        normalised = configurations.normalised_value(
            _tensor(tensor_id=361, device_id=3)
        )

        assert "tensor_id" not in normalised
        assert "device_id" not in normalised
        assert "is_allocated" not in normalised
        assert normalised == configurations.normalised_value(_tensor())
        assert "buffer_type=BufferType::L1" in normalised
        assert normalised.endswith("mesh_shape=MeshShape([1, 1]))")

    def test_an_older_tensors_data_preview_is_removed_ahead_of_its_shape(self):
        normalised = configurations.normalised_value(_older_tensor("0.00497"))

        assert normalised == (
            "ttnn.Tensor(shape=Shape([4096, 1024]), dtype=DataType::BFLOAT16, "
            "layout=Layout::TILE)"
        )
        assert normalised == configurations.normalised_value(_older_tensor("-0.17"))

    def test_each_devices_id_is_removed_from_a_tensor_spread_over_devices(self):
        per_device = (
            "device_id: 0, MeshCoordinate([0, 0])\n"
            + _older_tensor("1.0", "[32, 2]")
            + "\ndevice_id: 1, MeshCoordinate([0, 1])\n"
            + _older_tensor("2.0", "[32, 2]")
        )

        normalised = configurations.normalised_value(per_device)

        assert normalised.startswith("MeshCoordinate([0, 0])\nttnn.Tensor(shape=")
        assert "device_id" not in normalised
        assert "MeshCoordinate([0, 1])" in normalised

    def test_each_devices_id_is_removed_from_an_older_per_device_listing(self):
        per_device = (
            "device_id:0\n"
            + _older_tensor("1.0", "[32, 2]")
            + "\ndevice_id:1\n"
            + _older_tensor("2.0", "[32, 2]")
        )
        tensor = (
            "ttnn.Tensor(shape=Shape([32, 2]), dtype=DataType::BFLOAT16, "
            "layout=Layout::TILE)"
        )

        assert configurations.normalised_value(per_device) == f"{tensor}\n{tensor}"

    @pytest.mark.parametrize(
        "text",
        [
            "MeshDevice(num_devices=8, device_id=3)",
            "foo, is_allocated=False",
            "Config(x=1, tensor_id=4)",
            "device_id: 3, MeshCoordinate([0, 1])",
            "device_id:3\nnot a tensor",
        ],
    )
    def test_runtime_fields_outside_a_tensors_repr_are_kept(self, text):
        assert configurations.normalised_value(text) == text

    def test_runtime_fields_are_removed_from_each_tensor_and_kept_beside_it(self):
        beside = "MeshDevice(num_devices=8, device_id=3)"
        text = f"[{_tensor(tensor_id=4, device_id=2)}, {beside}, {_tensor()}]"
        tensor = configurations.normalised_value(_tensor())

        assert (
            configurations.normalised_value(text) == f"[{tensor}, {beside}, {tensor}]"
        )

    def test_a_tensor_cut_before_it_closes_still_loses_its_runtime_fields(self):
        text = (
            "ttnn.Tensor(shape=Shape([1]), tensor_id=4, is_allocated=True, device_id=0"
        )

        assert configurations.normalised_value(text) == "ttnn.Tensor(shape=Shape([1])"

    @pytest.mark.parametrize(
        "text",
        [
            "ttnn.Tensor([[1, 2]], shape=Shape([2]), dtype=X)",
            "ttnn.Tensor(shape=Shape([2]))",
            "ttnn.Tensor([[x]], dtype=X, shape=Shape([2]))",
            "[ttnn.Tensor([[1]], shape=Shape([1])), ttnn.Tensor([[2]], shape=Shape([1]))]",
            "ttnn.Tensor(ttnn.Tensor(ttnn.Tensor(shape=",
            "xttnn.Tensor(shape=y",
            "ttnn.Tensor(shape",
            "ttnn.Tensor(hape=",
        ],
    )
    def test_a_preview_is_cut_where_the_regex_it_replaces_cut_it(self, text):
        regex = re.compile(r"ttnn\.Tensor\([^=]*?shape=", re.DOTALL)

        assert configurations.normalised_value(text) == regex.sub(
            "ttnn.Tensor(shape=", text
        )

    @pytest.mark.parametrize("tail", ["", "=", ")" * 80_000])
    def test_openings_with_no_shape_are_read_in_one_pass(self, tail):
        """The regex form took 158 s on 960 KB of openings with no '=' after them."""
        crafted = "ttnn.Tensor(" * 80_000 + tail

        started = time.process_time()
        normalised = configurations.normalised_value(crafted)

        assert time.process_time() - started < _ONE_PASS_CPU_SECONDS
        assert normalised == crafted

    def test_device_prefixes_whose_coordinate_never_closes_are_read_in_one_pass(self):
        """A coordinate read past a '(' rescanned the line from each prefix: 52 s on
        these 928 KB. An older prefix ends its own line, so it was never slow."""
        crafted = "device_id: 1, MeshCoordinate(" * 32_000

        started = time.process_time()
        normalised = configurations.normalised_value(crafted)

        assert time.process_time() - started < _ONE_PASS_CPU_SECONDS
        assert normalised == crafted

    def test_a_missing_value_stays_missing(self):
        assert configurations.normalised_value(None) is None

    @pytest.mark.parametrize(
        "name, traced",
        [
            ("ttnn.matmul", True),
            ("ttnn::matmul", True),
            ("ttnn.experimental.nlp_concat_heads", True),
            ("ttnn.to_device", False),
            ("ttnn::deallocate", False),
            ("ttnn.from_torch", False),
            ("Tensor::to_device", False),
            ("MatmulDeviceOperation", False),
            ("", False),
        ],
    )
    def test_only_operations_the_tracer_records_are_traced(self, name, traced):
        assert configurations.is_traced(configurations.normalised_op_name(name)) is (
            traced
        )


class TestGrouping:
    def test_calls_differing_only_in_runtime_values_share_a_configuration(
        self, tmp_path
    ):
        """Tensor ids, devices and object addresses differ on every call of a model."""
        calls = [
            (
                "ttnn.add",
                [
                    ("0", _tensor(tensor_id=tensor_id, device_id=device_id)),
                    ("compute_kernel_config", f"<Config object at 0x{address:x}>"),
                ],
            )
            for tensor_id, device_id, address in [
                (1, 0, 0xA0),
                (7, 1, 0xB0),
                (9, 3, 0xC0),
            ]
        ]

        result = _listing(tmp_path, calls)

        assert result["configuration_count"] == 1
        assert result["configurations"][0]["calls"] == 3
        assert result["configurations"][0]["operation_ids"] == [1, 2, 3]

    def test_calls_differing_in_a_shape_are_two_configurations(self, tmp_path):
        calls = [
            ("ttnn.add", [("0", _tensor("[8, 384, 768]"))]),
            ("ttnn.add", [("0", _tensor("[8, 384, 3072]"))]),
        ]

        assert _listing(tmp_path, calls)["configuration_count"] == 2

    def test_semaphores_never_split_a_configuration(self, tmp_path):
        """The tracer drops its two semaphore keywords; any other semaphore, positional or
        not, is the same text on every call once its address is removed, as there."""

        def semaphores(*addresses: int) -> str:
            return "[" + ", ".join(map(_SEMAPHORE.format, addresses)) + "]"

        calls: List[Call] = []
        for base in (0x74B53B155F70, 0x7F7A007BE170):
            calls.append(
                (
                    "ttnn.experimental.all_gather_async",
                    [
                        ("0", _tensor()),
                        ("multi_device_global_semaphore", semaphores(base, base + 64)),
                        ("barrier_semaphore", _SEMAPHORE.format(base + 128)),
                    ],
                )
            )
            calls.append(
                (
                    "ttnn.experimental.all_reduce_async",
                    [
                        ("0", _tensor()),
                        ("1", _SEMAPHORE.format(base + 192)),
                        ("barrier_semaphores", semaphores(base, base + 352)),
                    ],
                )
            )

        result = _listing(tmp_path, calls)

        assert [row["calls"] for row in result["configurations"]] == [2, 2]
        kept = {
            row["op"]: {
                argument["name"]: argument["value"] for argument in row["arguments"]
            }
            for row in result["configurations"]
        }
        assert kept["ttnn.experimental.all_gather_async"].keys() == {"0"}
        assert kept["ttnn.experimental.all_reduce_async"]["barrier_semaphores"] == (
            "[<ttnn._ttnn.global_semaphore.global_semaphore object>, "
            "<ttnn._ttnn.global_semaphore.global_semaphore object>]"
        )

    def test_the_order_keywords_were_passed_in_never_splits_a_configuration(
        self, tmp_path
    ):
        keywords = [("dtype", "DataType.BFLOAT8_B"), ("memory_config", "L1")]
        calls = [
            ("ttnn.linear", [("0", _tensor()), *keywords]),
            ("ttnn.linear", [*reversed(keywords), ("0", _tensor())]),
        ]

        assert _listing(tmp_path, calls)["configuration_count"] == 1

    def test_positional_arguments_lead_in_position_order(self, tmp_path):
        names = ["dtype", "10", "2", "bias", "0"]

        result = _listing(tmp_path, [("ttnn.concat", [(name, "1") for name in names])])

        assert [
            argument["name"] for argument in result["configurations"][0]["arguments"]
        ] == ["0", "2", "10", "bias", "dtype"]

    def test_operations_the_tracer_never_records_are_counted_not_listed(self, tmp_path):
        calls = [
            ("ttnn.to_device", [("0", "x")]),
            ("ttnn.to_device", [("0", "y")]),
            ("ttnn::deallocate", []),
            ("Tensor::to_device", []),
            ("ttnn.matmul", [("0", _tensor())]),
        ]

        result = _listing(tmp_path, calls)

        assert [row["op"] for row in result["configurations"]] == ["ttnn.matmul"]
        assert result["calls"] == 1
        assert result["left_out_calls"] == 4
        assert result["left_out_op_count"] == 3
        assert result["left_out"] == [
            {"op": "ttnn.to_device", "calls": 2},
            {"op": "Tensor.to_device", "calls": 1},
            {"op": "ttnn.deallocate", "calls": 1},
        ]

    def test_a_value_not_recorded_differs_from_an_empty_one(self, tmp_path):
        calls = [
            ("ttnn.reshape", [("memory_config", None)]),
            ("ttnn.reshape", [("memory_config", "")]),
        ]

        arguments = sorted(
            (
                row["arguments"][0]
                for row in _listing(tmp_path, calls)["configurations"]
            ),
            key=lambda argument: argument["value"] is None,
        )

        assert arguments == [
            {"name": "memory_config", "value": ""},
            {"name": "memory_config", "value": None, "recorded": False},
        ]

    def test_arguments_that_cannot_be_attributed_to_a_rank_are_refused(self, tmp_path):
        path = _write_ranked_profiler(tmp_path / "ranked", _GRAPHS)
        _add_arguments(path, [(2, "0", _tensor())])
        registry = ReportRegistry()
        handle = load_report(registry, profiler_path=path)["handle"]

        with pytest.raises(ValueError, match="not on `operation_arguments`"):
            linking.op_configurations(registry, handle)

    def test_an_operation_with_no_arguments_is_one_configuration(self, tmp_path):
        result = _listing(tmp_path, [("ttnn.relu", []), ("ttnn.relu", [])])

        assert result["configurations"][0]["calls"] == 2
        assert result["configurations"][0]["argument_count"] == 0

    def test_a_position_too_long_for_int_sorts_after_shorter_ones(self, tmp_path):
        """`int()` refuses past 4,300 digits."""
        position = "1" * 5_000

        result = _listing(tmp_path, [("ttnn.concat", [(position, "a"), ("10", "b")])])

        assert [
            argument["name"] for argument in result["configurations"][0]["arguments"]
        ] == ["10", position[: configurations.MAX_ARGUMENT_NAME_CHARS]]

    def test_a_name_kept_as_null_or_a_blob_still_answers(self, tmp_path):
        calls = [("ttnn.relu", [(None, "x"), (b"\xffname", "y")]), (b"ttnn.add", [])]

        result = _listing(tmp_path, calls)

        row = result["configurations"][0]
        assert [argument["name"] for argument in row["arguments"]] == [
            "",
            "b'\\xffname'",
        ]
        assert re.fullmatch(r"[0-9a-f]{16}", row["config_digest"])
        assert result["left_out"] == [{"op": "b'ttnn.add'", "calls": 1}]

    def test_numbers_kept_where_text_belongs_are_grouped_by_their_text(self, tmp_path):
        """Pins the read's cache key, the text, which tells apart equal values such as
        0.0 and -0.0; it would pass with no cache at all."""
        values = [0.0, -0.0, 1, 1.0]
        registry, handle = load_memory_report(
            tmp_path,
            _SCHEMA.replace("value text", "value"),
            [
                *(("operations", (index, "ttnn.add", 0.1)) for index in range(1, 5)),
                *(
                    ("operation_arguments", (index, "0", value))
                    for index, value in enumerate(values, start=1)
                ),
            ],
        )

        result = linking.op_configurations(registry, handle)

        assert sorted(
            row["arguments"][0]["value"] for row in result["configurations"]
        ) == ["-0.0", "0.0", "1", "1.0"]

    def test_a_lone_surrogate_is_digested_rather_than_failing(self):
        digest = configurations.configuration_digest("ttnn.add", (("0", "\ud800"),))

        assert re.fullmatch(r"[0-9a-f]{16}", digest)


class TestListing:
    _CALLS: List[Call] = [
        ("ttnn.add", [("0", _tensor("[1, 32]"))]),
        ("ttnn.matmul", [("0", _tensor("[32, 32]"))]),
        ("ttnn.matmul", [("0", _tensor("[32, 32]"))]),
        ("ttnn.matmul", [("0", _tensor("[64, 32]"))]),
        ("ttnn.to_device", [("0", "x")]),
        ("ttnn.matmul", [("0", _tensor("[32, 32]"))]),
    ]

    def test_without_a_linked_report_it_ranks_by_calls(self, tmp_path):
        result = _listing(tmp_path, self._CALLS)

        assert [(row["op"], row["calls"]) for row in result["configurations"]] == [
            ("ttnn.matmul", 3),
            ("ttnn.add", 1),
            ("ttnn.matmul", 1),
        ]
        assert result["ops"] == [
            {"op": "ttnn.matmul", "calls": 4, "configurations": 2},
            {"op": "ttnn.add", "calls": 1, "configurations": 1},
        ]
        assert (result["calls"], result["configuration_count"], result["op_count"]) == (
            5,
            3,
            2,
        )
        assert result["operation_link"]["status"] == LinkStatus.UNAVAILABLE.value
        assert "device_time" not in result["configurations"][0]
        assert "device_time_unit" not in result
        assert "projection" not in result

    def test_name_contains_narrows_every_list_ignoring_case(self, tmp_path):
        result = _listing(tmp_path, self._CALLS, name_contains=" MatMul ")

        assert {row["op"] for row in result["configurations"]} == {"ttnn.matmul"}
        assert [row["op"] for row in result["ops"]] == ["ttnn.matmul"]
        assert result["left_out"] == []
        assert result["name_contains"] == " MatMul "

    def test_a_name_contains_of_spaces_alone_lists_every_operation(self, tmp_path):
        """Echoed as given, as `find_operations` echoes it."""
        registry, handle = _capture(tmp_path, self._CALLS)

        unfiltered = linking.op_configurations(registry, handle)
        spaces = linking.op_configurations(registry, handle, name_contains="   ")

        assert unfiltered.pop("name_contains") is None
        assert spaces.pop("name_contains") == "   "
        assert spaces == unfiltered

    def test_name_contains_reads_cpp_separators_as_dots(self, tmp_path):
        calls = [
            ("ttnn::matmul", [("0", _tensor())]),
            ("ttnn::to_device", [("0", "x")]),
        ]

        matmul = _listing(tmp_path / "matmul", calls, name_contains="ttnn::matmul")
        moved = _listing(tmp_path / "moved", calls, name_contains="ttnn::to_device")

        assert [row["op"] for row in matmul["configurations"]] == ["ttnn.matmul"]
        assert moved["left_out"] == [{"op": "ttnn.to_device", "calls": 1}]

    def test_name_contains_narrows_the_untraced_operations_too(self, tmp_path):
        result = _listing(tmp_path, self._CALLS, name_contains="to_device")

        assert result["configurations"] == []
        assert result["left_out"] == [{"op": "ttnn.to_device", "calls": 1}]

    def test_limit_caps_the_listing_and_not_the_counts(self, tmp_path):
        result = _listing(tmp_path, self._CALLS, limit=1)

        assert result["returned"] == 1
        assert result["configuration_count"] == 3

    def test_limit_is_capped(self, tmp_path):
        calls = [
            ("ttnn.add", [("0", _tensor(f"[1, {width}]"))])
            for width in range(configurations.MAX_LISTED_CONFIGURATIONS + 5)
        ]

        result = _listing(tmp_path, calls, limit=MAX_LIMIT)

        assert result["returned"] == configurations.MAX_LISTED_CONFIGURATIONS

    def test_a_listing_shows_the_first_arguments_cut_short(self, tmp_path):
        long_value = "v" * (configurations.LISTED_VALUE_CHARS + 50)
        arguments = [
            (f"{position}", long_value)
            for position in range(configurations.MAX_LISTED_ARGUMENTS + 3)
        ]

        row = _listing(tmp_path, [("ttnn.concat", arguments)])["configurations"][0]

        assert row["argument_count"] == configurations.MAX_LISTED_ARGUMENTS + 3
        assert len(row["arguments"]) == configurations.MAX_LISTED_ARGUMENTS
        assert row["arguments"][0] == {
            "name": "0",
            "value": "v" * configurations.LISTED_VALUE_CHARS,
            "value_full_length": configurations.LISTED_VALUE_CHARS + 50,
        }

    @pytest.mark.parametrize(
        "tensor",
        [
            # The tensor whose buffer type ends latest in the local captures.
            _tensor("[1, 1, 3200, 8, 7168]", layout="ROW_MAJOR", buffer_type="DRAM"),
            _tensor(
                "[1024, 1024, 1024, 1024, 1024, 1024]",
                memory_layout="HEIGHT_SHARDED",
                layout="ROW_MAJOR",
                buffer_type="DRAM",
                dtype="BFLOAT8_B",
            ),
        ],
    )
    def test_a_listing_shows_a_tensors_buffer_type(self, tmp_path, tensor):
        row = _listing(tmp_path, [("ttnn.add", [("0", tensor)])])["configurations"][0]

        assert "buffer_type=BufferType::DRAM" in row["arguments"][0]["value"]

    def test_a_listing_names_the_first_operation_ids(self, tmp_path):
        calls = [("ttnn.relu", [("0", "x")])] * (
            configurations.MAX_LISTED_OPERATION_IDS + 2
        )

        row = _listing(tmp_path, calls)["configurations"][0]

        assert row["calls"] == configurations.MAX_LISTED_OPERATION_IDS + 2
        assert row["operation_ids"] == list(
            range(1, configurations.MAX_LISTED_OPERATION_IDS + 1)
        )

    def test_a_capture_without_memory_configs_says_so(self, tmp_path):
        older = _listing(
            tmp_path / "older", [("ttnn.matmul", [("0", _older_tensor("0.1"))])]
        )
        current = _listing(tmp_path / "current", [("ttnn.matmul", [("0", _tensor())])])

        assert configurations.MEMORY_CONFIG_CAVEAT in older.get("caveat", "")
        assert configurations.MEMORY_CONFIG_CAVEAT not in current.get("caveat", "")

    def test_it_states_how_calls_were_grouped(self, tmp_path):
        result = _listing(tmp_path, self._CALLS)

        assert result["grouping"] == configurations.GROUPING
        assert result["note"] == configurations.NOTE

    def test_configurations_alike_in_time_and_calls_come_in_first_call_order(self):
        """A read is in first-call order, so only one out of order reaches this tiebreak."""
        later, earlier = (
            configurations.Configuration(
                op="ttnn.add",
                arguments=(("0", shape),),
                operation_ids=ids,
                digest=digest,
            )
            for shape, ids, digest in [
                ("[2]", (3, 4), "b" * 16),
                ("[1]", (1, 2), "a" * 16),
            ]
        )
        read = configurations.Configurations(
            configurations=(later, earlier),
            left_out={},
            tensors_without_memory_config=False,
        )

        result = configurations.answer(
            "handle", read, RankScope(multi_host=False, rank=None), None, {}
        )

        assert [row["operation_ids"] for row in result["configurations"]] == [
            [1, 2],
            [3, 4],
        ]


class TestOneConfiguration:
    def test_a_digest_answers_its_configuration_at_length(self, tmp_path):
        long_value = "v" * (configurations.DETAIL_VALUE_CHARS + 10)
        arguments = [
            (f"{position}", long_value)
            for position in range(configurations.MAX_DETAIL_ARGUMENTS + 2)
        ]
        calls = [("ttnn.concat", arguments)] * (MAX_LIMIT + 5)
        registry, handle = _capture(tmp_path, calls)
        digest = linking.op_configurations(registry, handle)["configurations"][0][
            "config_digest"
        ]

        result = linking.op_configurations(registry, handle, config_digest=digest)

        assert result["config_digest"] == digest
        assert result["calls"] == MAX_LIMIT + 5
        assert result["operation_ids"] == list(range(1, MAX_LIMIT + 1))
        assert result["argument_count"] == configurations.MAX_DETAIL_ARGUMENTS + 2
        assert len(result["arguments"]) == configurations.MAX_DETAIL_ARGUMENTS
        assert (
            result["arguments"][0]["value"] == "v" * configurations.DETAIL_VALUE_CHARS
        )
        assert "configurations" not in result

    def test_a_digest_is_read_whatever_its_case_and_spacing(self, tmp_path):
        registry, handle = _capture(tmp_path, [("ttnn.relu", [("0", "x")])])
        digest = linking.op_configurations(registry, handle)["configurations"][0][
            "config_digest"
        ]

        result = linking.op_configurations(
            registry, handle, config_digest=f" {digest.upper()} "
        )

        assert result["config_digest"] == digest

    def test_a_digest_is_answered_under_a_name_contains_that_matches_it(self, tmp_path):
        registry, handle = _capture(tmp_path, TestListing._CALLS)
        matmul = next(
            row
            for row in linking.op_configurations(registry, handle)["configurations"]
            if row["op"] == "ttnn.matmul"
        )

        result = linking.op_configurations(
            registry,
            handle,
            config_digest=matmul["config_digest"],
            name_contains="MATMUL",
        )

        assert (result["op"], result["config_digest"], result["calls"]) == (
            "ttnn.matmul",
            matmul["config_digest"],
            matmul["calls"],
        )

    def test_the_same_configuration_has_the_same_digest_in_another_capture(
        self, tmp_path
    ):
        first = _listing(
            tmp_path / "first",
            [("ttnn.add", [("0", _tensor(tensor_id=4, device_id=0))])],
        )
        second = _listing(
            tmp_path / "second",
            [
                ("ttnn.relu", []),
                ("ttnn.add", [("0", _tensor(tensor_id=90, device_id=7))]),
            ],
        )

        first_add, second_add = (
            next(row for row in result["configurations"] if row["op"] == "ttnn.add")
            for result in (first, second)
        )
        assert len(first_add["config_digest"]) == 16
        assert first_add["config_digest"] == second_add["config_digest"]

    def test_a_configurations_digest_is_pinned(self):
        """An agent may keep a digest, so its layout cannot change unnoticed."""
        arguments = (
            ("0", "ttnn.Tensor(shape=Shape([1, 32]), dtype=DataType::BFLOAT16)"),
            ("name", "é"),
            ("output_tensor", None),
        )

        digest = configurations.configuration_digest("ttnn.add", arguments)

        assert digest == "d212c64127e0e06e"

    def test_configurations_sharing_a_digest_answer_the_first_and_say_so(
        self, tmp_path
    ):
        calls = [("ttnn.relu", [("0", "x")]), ("ttnn.gelu", [("0", "x")])]

        with patch.object(
            configurations, "configuration_digest", return_value="0" * 16
        ):
            result = _listing(tmp_path, calls, config_digest="0" * 16)

        assert result["op"] == "ttnn.gelu"
        assert "2 configurations share this digest; this is the first." in (
            result["caveat"]
        )

    def test_two_operations_called_alike_have_their_own_digests(self, tmp_path):
        registry, handle = _capture(
            tmp_path, [("ttnn.relu", [("0", "x")]), ("ttnn.gelu", [("0", "x")])]
        )
        digests = {
            row["op"]: row["config_digest"]
            for row in linking.op_configurations(registry, handle)["configurations"]
        }

        result = linking.op_configurations(
            registry, handle, config_digest=digests["ttnn.gelu"]
        )

        assert digests["ttnn.relu"] != digests["ttnn.gelu"]
        assert result["op"] == "ttnn.gelu"

    @pytest.mark.parametrize("digest", ["", "abc", "z" * 16, "0" * 17])
    def test_a_digest_that_is_not_one_is_refused(self, tmp_path, digest):
        registry, handle = _capture(tmp_path, [("ttnn.relu", [])])

        with pytest.raises(ValueError, match="16 hexadecimal digits"):
            linking.op_configurations(registry, handle, config_digest=digest)

    def test_an_unknown_digest_is_refused_naming_the_filter(self, tmp_path):
        registry, handle = _capture(tmp_path, [("ttnn.relu", [])])
        digest = linking.op_configurations(registry, handle)["configurations"][0][
            "config_digest"
        ]

        with pytest.raises(ValueError, match="no configuration with config_digest"):
            linking.op_configurations(registry, handle, config_digest="0" * 16)
        with pytest.raises(ValueError, match="matching name_contains"):
            linking.op_configurations(
                registry, handle, config_digest=digest, name_contains="matmul"
            )


class TestDeviceTime:
    _TIMED_OPERATIONS = [
        (1, "ttnn.matmul"),
        (2, "ttnn.matmul"),
        (3, "ttnn.add"),
        (4, "ttnn.deallocate"),
    ]
    _TIMED_GRAPHS = {
        1: _graph("ttnn.matmul", "MatmulDeviceOperation"),
        2: _graph("ttnn.matmul", "MatmulDeviceOperation"),
        3: _graph("ttnn.add", "BinaryNgDeviceOperation"),
        4: _graph("ttnn.deallocate"),
    }
    # The second matmul's row has no device time, so that call is untimed.
    _TIMED_ROWS = [
        _perf_row("MatmulDeviceOperation", 1),
        {**_perf_row("MatmulDeviceOperation", 2), "device_time": ""},
        {**_perf_row("BinaryNgDeviceOperation", 3), "device_time": "9.0"},
    ]

    _TIMED_ARGUMENTS = [
        (1, "0", _tensor("[32, 32]")),
        (2, "0", _tensor("[32, 32]", tensor_id=5)),
        (3, "0", _tensor("[1, 32]")),
    ]

    def _linked_capture(
        self,
        linked,
        tmp_path,
        operations=_TIMED_OPERATIONS,
        graphs=_TIMED_GRAPHS,
        rows=_TIMED_ROWS,
        arguments=_TIMED_ARGUMENTS,
    ):
        path = _write_profiler(tmp_path / "configured", graphs, operations=operations)
        _add_arguments(path, arguments)
        registry, handle, _ = linked(profiler_path=path, rows=rows)
        return registry, handle

    def test_a_linked_report_ranks_by_summed_device_time(self, linked, tmp_path):
        registry, handle = self._linked_capture(linked, tmp_path)

        result = linking.op_configurations(registry, handle)

        assert result["operation_link"]["status"] == LinkStatus.LINKED.value
        assert [
            (row["op"], row["calls"], row["device_time"], row["untimed_calls"])
            for row in result["configurations"]
        ] == [("ttnn.add", 1, 9.0, 0), ("ttnn.matmul", 2, 1.0, 1)]
        assert result["configurations"][0]["device_time_share_percent"] == 90.0
        assert result["report_device_time_total"] == 10.0
        assert result["device_time_unit"] == linking.DEVICE_TIME_UNIT
        assert result["projection"] == tools.projection(None)
        assert [
            (
                row["op"],
                row["device_time"],
                row["device_time_share_percent"],
                row["untimed_calls"],
            )
            for row in result["ops"]
        ] == [("ttnn.add", 9.0, 90.0, 0), ("ttnn.matmul", 1.0, 10.0, 1)]
        assert "1 of these 3 calls launched no performance row" in result["caveat"]

    def test_device_time_sums_every_call_and_every_configuration(
        self, linked, tmp_path
    ):
        times = {1: "1.0", 2: "2.0", 3: "4.0"}
        registry, handle = self._linked_capture(
            linked,
            tmp_path,
            operations=[(operation_id, "ttnn.matmul") for operation_id in times],
            graphs={
                operation_id: _graph("ttnn.matmul", "MatmulDeviceOperation")
                for operation_id in times
            },
            rows=[
                {**_perf_row("MatmulDeviceOperation", row_id), "device_time": time}
                for row_id, time in times.items()
            ],
            arguments=[
                (1, "0", _tensor("[32, 32]")),
                (2, "0", _tensor("[32, 32]")),
                (3, "0", _tensor("[64, 32]")),
            ],
        )

        result = linking.op_configurations(registry, handle)

        assert [
            (row["calls"], row["device_time"]) for row in result["configurations"]
        ] == [(1, 4.0), (2, 3.0)]
        assert result["ops"] == [
            {
                "op": "ttnn.matmul",
                "calls": 3,
                "configurations": 2,
                "device_time": 7.0,
                "device_time_share_percent": 100.0,
                "untimed_calls": 0,
            }
        ]

    def test_an_op_with_an_untimed_configuration_counts_its_untimed_calls(
        self, linked, tmp_path
    ):
        """The op's device time is its timed configuration's alone, so its row says
        how many calls that time leaves out."""
        registry, handle = self._linked_capture(
            linked,
            tmp_path,
            operations=[(1, "ttnn.matmul"), (2, "ttnn.matmul")],
            graphs={
                operation_id: _graph("ttnn.matmul", "MatmulDeviceOperation")
                for operation_id in (1, 2)
            },
            rows=[
                {**_perf_row("MatmulDeviceOperation", 1), "device_time": "2.0"},
                {**_perf_row("MatmulDeviceOperation", 2), "device_time": ""},
            ],
            arguments=[(1, "0", _tensor("[32, 32]")), (2, "0", _tensor("[64, 32]"))],
        )

        result = linking.op_configurations(registry, handle)

        assert [
            (row["calls"], row["device_time"], row["untimed_calls"])
            for row in result["configurations"]
        ] == [(1, 2.0, 0), (1, None, 1)]
        assert result["ops"] == [
            {
                "op": "ttnn.matmul",
                "calls": 2,
                "configurations": 2,
                "device_time": 2.0,
                "device_time_share_percent": 100.0,
                "untimed_calls": 1,
            }
        ]

    def test_a_single_call_configuration_is_timed_as_operation_detail_times_it(
        self, linked, tmp_path
    ):
        """`operation_device_time` promises the tools agree."""
        registry, handle = self._linked_capture(linked, tmp_path)
        add = next(
            row
            for row in linking.op_configurations(registry, handle)["configurations"]
            if row["op"] == "ttnn.add"
        )

        detail = linking.operation_detail(
            registry, handle, operation_id=add["operation_ids"][0]
        )

        assert add["calls"] == 1
        assert add["device_time"] == detail["device_time"] == 9.0

    def test_untimed_configurations_rank_after_timed_ones(self, linked, tmp_path):
        relus = (2, 3, 4)
        registry, handle = self._linked_capture(
            linked,
            tmp_path,
            operations=[(1, "ttnn.add"), *((index, "ttnn.relu") for index in relus)],
            graphs={
                1: _graph("ttnn.add", "BinaryNgDeviceOperation"),
                **{
                    index: _graph("ttnn.relu", "UnaryDeviceOperation")
                    for index in relus
                },
            },
            rows=[
                {**_perf_row("BinaryNgDeviceOperation", 1), "device_time": "9.0"},
                *(
                    {**_perf_row("UnaryDeviceOperation", index), "device_time": ""}
                    for index in relus
                ),
            ],
            arguments=[(index, "0", _tensor("[1, 32]")) for index in (1, *relus)],
        )

        result = linking.op_configurations(registry, handle)

        assert [
            (
                row["op"],
                row["device_time"],
                row["device_time_share_percent"],
                row["untimed_calls"],
            )
            for row in result["configurations"]
        ] == [("ttnn.add", 9.0, 100.0, 0), ("ttnn.relu", None, None, 3)]
        assert [
            (
                row["op"],
                row["device_time"],
                row["device_time_share_percent"],
                row["untimed_calls"],
            )
            for row in result["ops"]
        ] == [("ttnn.add", 9.0, 100.0, 0), ("ttnn.relu", None, None, 3)]

    def test_a_partitioned_run_carries_its_caveat(self, linked, tmp_path):
        """Shares divide by a total that assumes the sub-devices ran one after another."""
        rows = [
            {**row, "sub_device_id": str(index % 2)}
            for index, row in enumerate(self._TIMED_ROWS)
        ]
        registry, handle = self._linked_capture(linked, tmp_path, rows=rows)

        assert "2 sub-devices" in linking.op_configurations(registry, handle)["caveat"]

    def test_one_configuration_counts_its_own_untimed_calls(self, linked, tmp_path):
        registry, handle = self._linked_capture(linked, tmp_path)
        matmul = next(
            row
            for row in linking.op_configurations(registry, handle)["configurations"]
            if row["op"] == "ttnn.matmul"
        )

        result = linking.op_configurations(
            registry, handle, config_digest=matmul["config_digest"]
        )

        assert (result["device_time"], result["untimed_calls"]) == (1.0, 1)
        assert "1 of its 2 calls launched no performance row" in result["caveat"]

    def test_a_rank_other_than_the_linked_one_carries_no_device_time(
        self, linked, tmp_path
    ):
        """Rank 1's operation N is not the one rank 0's linked rows belong to."""
        path = _write_ranked_profiler(tmp_path / "ranked", _GRAPHS)
        _add_arguments(
            path,
            [(2, "0", _tensor(), 0), (2, "0", _tensor(), 1), (3, "0", "x", 1)],
            ranked=True,
        )
        registry, handle, _ = linked(profiler_path=path)

        at_rank_zero = linking.op_configurations(registry, handle)
        at_rank_one = linking.op_configurations(registry, handle, rank=1)

        def called(result):
            return sorted(
                (row["op"], row["calls"], row["argument_count"])
                for row in result["configurations"]
            )

        # Rank 1 adds a relu and an argument to its add, so a read that unions the
        # ranks, or answers one rank from the other's grouping, changes these.
        assert called(at_rank_zero) == [("ttnn.add", 1, 0), ("ttnn.matmul", 1, 1)]
        assert called(at_rank_one) == [
            ("ttnn.add", 1, 1),
            ("ttnn.matmul", 1, 1),
            ("ttnn.relu", 1, 0),
        ]
        assert at_rank_zero["operation_link"]["status"] == LinkStatus.LINKED.value
        assert "device_time" in at_rank_zero["configurations"][0]
        assert at_rank_one["rank"] == 1
        assert at_rank_one["operation_link"] == {
            "status": LinkStatus.UNAVAILABLE.value,
            "reason": "performance rows are linked to rank 0 only; the grouping was "
            "read at rank 1",
        }
        assert all("device_time" not in row for row in at_rank_one["configurations"])


class TestServer:
    def test_it_answers_through_the_server_with_a_link_template(self, tmp_path):
        registry, handle = _capture(tmp_path, [("ttnn.relu", [("0", "x")])])

        result, outcome = tool_call(registry, "op_configurations", {"handle": handle})

        assert not result.get("isError")
        answer = json.loads(result["content"][0]["text"])
        assert answer["configurations"][0]["op"] == "ttnn.relu"
        assert "{operation_id}" in answer["app_link_template"]
        assert outcome.value == "ok"

    def test_a_digest_that_is_not_one_is_an_error_naming_the_form(self, tmp_path):
        registry, handle = _capture(tmp_path, [("ttnn.relu", [])])

        result, outcome = tool_call(
            registry, "op_configurations", {"handle": handle, "config_digest": "abc"}
        )

        assert result.get("isError")
        assert "16 hexadecimal digits" in result["content"][0]["text"]
        assert outcome.value == "refused"

    def test_the_description_states_what_the_grouping_removes(self):
        table = server._tool_table(ReportRegistry())
        description = table[McpToolName.OP_CONFIGURATIONS]["description"]

        assert configurations.REMOVED_FROM_TEXT in description
        assert configurations.REMOVED_FROM_TEXT in configurations.GROUPING

    def test_load_report_lists_it_only_with_the_arguments_table(self, tmp_path):
        _capture(tmp_path / "with", [("ttnn.relu", [])])
        (tmp_path / "without").mkdir()
        load_memory_report(
            tmp_path / "without",
            "CREATE TABLE operations (operation_id int, name text, duration float);",
            [("operations", (1, "ttnn.relu", 0.1))],
        )

        def listed(name: str) -> bool:
            path = str(tmp_path / name / "profiler")
            answerable = load_report(ReportRegistry(), profiler_path=path)["answerable"]
            assert isinstance(answerable, list)
            return "op_configurations" in answerable

        assert listed("with")
        assert not listed("without")

    def test_the_grouping_is_read_once_per_handle_and_rank(self, tmp_path):
        registry, handle = _capture(tmp_path, [("ttnn.relu", [("0", "x")])])

        with patch.object(
            configurations,
            "read_configurations",
            wraps=configurations.read_configurations,
        ) as read:
            first = linking.op_configurations(registry, handle)
            linking.op_configurations(registry, handle, name_contains="relu")
            linking.op_configurations(
                registry,
                handle,
                config_digest=first["configurations"][0]["config_digest"],
            )

        read.assert_called_once()

    def test_the_grouping_is_read_once_for_each_rank(self, tmp_path):
        path = _write_ranked_profiler(tmp_path / "ranked", _GRAPHS)
        _add_arguments(path, [(2, "0", "x", 0), (2, "0", "x", 1)], ranked=True)
        registry = ReportRegistry()
        handle = load_report(registry, profiler_path=path)["handle"]
        signature = inspect.signature(configurations.read_configurations)

        with patch.object(
            configurations,
            "read_configurations",
            wraps=configurations.read_configurations,
        ) as read:
            for rank in (0, 1, 0, 1):
                linking.op_configurations(registry, handle, rank=rank)

        assert [
            signature.bind(*call.args, **call.kwargs).arguments["scope"].rank
            for call in read.call_args_list
        ] == [0, 1]


class TestAnswerSize:
    """Every cap reached at once, each text past its cut, in ASCII JSON need not escape,
    as reprs are; escaped text can pass the budget, as #2298 tracks for every tool.
    Timed, every row carries its device time fields too."""

    @staticmethod
    def _arguments(count: int, value_chars: int, variant: int):
        return [
            (f"{position:02d}" + "n" * 300, f"variant{variant}-" + "e" * value_chars)
            for position in range(count)
        ]

    @staticmethod
    def _timed(timed: bool, call_count: int):
        """With `timed`, a link timing each of `call_count` calls."""
        if not timed:
            return contextlib.nullcontext()
        operation_ids = range(1, call_count + 1)
        link = OperationLink(
            LinkStatus.LINKED,
            matched_on=MatchedOn.FUNCTION_START_COLLAPSED,
            operation_by_perf_id={str(index): index for index in operation_ids},
            device_time_by_operation={index: 1234567.891 for index in operation_ids},
            report_device_time_total=1234567.891 * call_count,
        )
        return patch.object(linking, "operation_link", return_value=link)

    def _answer(self, registry, handle, **arguments) -> str:
        result, _ = tool_call(
            registry, "op_configurations", {"handle": handle, **arguments}
        )
        assert not result.get("isError")
        return result["content"][0]["text"]

    @pytest.mark.parametrize("timed", [False, True])
    def test_the_most_a_listing_can_hold_stays_inside_the_budget(self, tmp_path, timed):
        arguments = configurations.MAX_LISTED_ARGUMENTS + 1
        value_chars = configurations.LISTED_VALUE_CHARS + 100
        calls: List[Call] = [
            (
                f"ttnn.op{index:02d}_" + "x" * 300,
                self._arguments(arguments, value_chars, variant),
            )
            for index in range(configurations.MAX_LISTED_OPS + 5)
            for variant in range(2)
            for _ in range(configurations.MAX_LISTED_OPERATION_IDS + 1)
        ]
        calls.extend(
            (f"Tensor::left{index:02d}" + "y" * 300, [])
            for index in range(configurations.MAX_LISTED_LEFT_OUT + 5)
        )
        registry, handle = _capture(tmp_path, calls)

        with self._timed(timed, len(calls)):
            text = self._answer(registry, handle, limit=MAX_LIMIT)

        assert len(text.encode()) < ANSWER_BUDGET_BYTES
        result = json.loads(text)
        assert result["returned"] == configurations.MAX_LISTED_CONFIGURATIONS
        assert len(result["ops"]) == configurations.MAX_LISTED_OPS
        assert len(result["left_out"]) == configurations.MAX_LISTED_LEFT_OUT
        assert ("untimed_calls" in result["ops"][0]) is timed

    @pytest.mark.parametrize("timed", [False, True])
    def test_the_most_one_configuration_can_hold_stays_inside_the_budget(
        self, tmp_path, timed
    ):
        arguments = self._arguments(
            configurations.MAX_DETAIL_ARGUMENTS + 1,
            configurations.DETAIL_VALUE_CHARS + 100,
            variant=0,
        )
        calls = [("ttnn.op_" + "x" * 300, arguments)] * (MAX_LIMIT + 1)
        registry, handle = _capture(tmp_path, calls)
        digest = json.loads(self._answer(registry, handle))["configurations"][0][
            "config_digest"
        ]

        with self._timed(timed, len(calls)):
            text = self._answer(registry, handle, config_digest=digest)

        assert len(text.encode()) < ANSWER_BUDGET_BYTES
        result = json.loads(text)
        assert len(result["arguments"]) == configurations.MAX_DETAIL_ARGUMENTS
        assert len(result["operation_ids"]) == MAX_LIMIT
        assert ("untimed_calls" in result) is timed
