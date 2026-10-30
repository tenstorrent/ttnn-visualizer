# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The operation graph as a whole: `agent/op_graph.py` and `subgraph_between`. #2174

What the critical path golden does not reach: how the graph is read from the
database, which operations the graph view keeps, and the paths between two
operations. The search itself is held by `test_agent_critical_path_parity.py`.
"""

import sqlite3
from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import op_graph
from ttnn_visualizer.agent import operations as agent_operations
from ttnn_visualizer.agent import server
from ttnn_visualizer.agent.bounds import MAX_DETAILED_LIMIT, MAX_LIMIT
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.agent.op_graph import GraphEdge
from ttnn_visualizer.queries import DatabaseQueries

# A diamond, 1 -> {2, 3} -> 4, then 4 -> 5 and a deallocate of 4's output. Op 7
# consumes a tensor no operation produced, and op 8 touches no tensor at all.
_GRAPH_SQL = """
CREATE TABLE operations (operation_id int UNIQUE, name text, duration float);
CREATE TABLE tensors (
    tensor_id int UNIQUE, shape text, dtype text, layout text, memory_config text,
    device_id int, address int, buffer_type text
);
CREATE TABLE input_tensors (operation_id int, input_index int, tensor_id int);
CREATE TABLE output_tensors (operation_id int, output_index int, tensor_id int);

INSERT INTO operations VALUES
    (1, 'ttnn.from_torch', 0.1),
    (2, 'ttnn.matmul', 0.1),
    (3, 'ttnn.add', 0.1),
    (4, 'ttnn.concat', 0.1),
    (5, 'ttnn.relu', 0.1),
    (6, 'ttnn::deallocate', 0.1),
    (7, 'ttnn.to_device', 0.1),
    (8, 'ttnn.isolated', 0.1);

INSERT INTO tensors VALUES
    (10, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL),
    (11, 'Shape([1, 32])', 'DataType.BFLOAT8_B', 'Layout.TILE',
     'MemoryConfig(memory_layout=TensorMemoryLayout::HEIGHT_SHARDED,buffer_type=BufferType::L1,shard_spec=std::nullopt)',
     0, NULL, NULL),
    (12, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL),
    (13, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL),
    (14, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL);

INSERT INTO output_tensors VALUES (1, 0, 10), (2, 0, 11), (3, 0, 12), (4, 0, 13);
INSERT INTO input_tensors VALUES
    (2, 0, 10), (3, 0, 10), (4, 0, 11), (4, 1, 12), (5, 0, 13), (6, 0, 13), (7, 0, 14);
"""


# Two ranks sharing operation and tensor ids, with different edges: rank 0 runs
# 1 -> 2 -> 3 and rank 1 runs 1 -> 3 directly, so a read that leaked one rank into
# the other would add an edge.
_RANKED_GRAPH_SQL = """
CREATE TABLE operations (
    operation_id int, name text, duration float, rank int NOT NULL DEFAULT 0
);
CREATE TABLE tensors (
    tensor_id int, shape text, dtype text, layout text, memory_config text,
    device_id int, address int, buffer_type text, rank int NOT NULL DEFAULT 0
);
CREATE TABLE input_tensors (
    operation_id int, input_index int, tensor_id int, rank int NOT NULL DEFAULT 0
);
CREATE TABLE output_tensors (
    operation_id int, output_index int, tensor_id int, rank int NOT NULL DEFAULT 0
);

INSERT INTO operations VALUES
    (1, 'ttnn.from_torch', 0.1, 0), (2, 'ttnn.matmul', 0.1, 0), (3, 'ttnn.add', 0.1, 0),
    (1, 'ttnn.from_torch', 0.1, 1), (2, 'ttnn.matmul', 0.1, 1), (3, 'ttnn.add', 0.1, 1);
INSERT INTO tensors VALUES
    (10, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL, 0),
    (11, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL, 0),
    (10, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL, 1);
INSERT INTO output_tensors VALUES (1, 0, 10, 0), (2, 0, 11, 0), (1, 0, 10, 1);
INSERT INTO input_tensors VALUES (2, 0, 10, 0), (3, 0, 11, 0), (3, 0, 10, 1);
"""


def _load(tmp_path, sql: str, name: str = "profiler"):
    directory = tmp_path / name
    directory.mkdir()
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(sql)
        connection.commit()
    finally:
        connection.close()
    registry = ReportRegistry()
    handle = load_report(registry, profiler_path=str(directory))["handle"]
    return registry, handle


@pytest.fixture
def graph_report(tmp_path):
    return _load(tmp_path, _GRAPH_SQL)


def _read(report) -> op_graph.OpGraph:
    registry, handle = report
    with agent_operations.profiler_db(registry.get(handle)) as queries:
        scope = agent_operations.rank_scope(queries, None)
        return agent_operations.read_scoped_graph(registry, handle, queries, scope)


class TestReadGraph:
    def test_it_emits_one_edge_per_tensor_and_consumer(self, graph_report):

        graph = _read(graph_report)

        assert sorted(
            (edge.source, edge.target, edge.tensor_id) for edge in graph.edges
        ) == [
            (1, 2, 10),
            (1, 3, 10),
            (2, 4, 11),
            (3, 4, 12),
            (4, 5, 13),
            (4, 6, 13),
        ]
        assert graph.names[8] == "ttnn.isolated"

    def test_it_drops_an_edge_to_an_operation_out_of_scope(self):
        graph = op_graph.build_graph(
            {1: "a", 2: "b"}, [GraphEdge(1, 2, 10), GraphEdge(1, 9, 11)]
        )

        assert graph.edges == [GraphEdge(1, 2, 10)]
        assert 9 not in graph.incoming


class TestKeptOperations:
    def test_it_keeps_what_the_graph_view_draws(self, graph_report):

        kept = op_graph.kept_operation_ids(_read(graph_report))

        # 6 is a deallocate, under either separator; 7 consumes only a tensor with
        # no producer, and 8 touches none, so neither has an edge.
        assert kept == {1, 2, 3, 4, 5}

    def test_it_hides_either_deallocate_spelling(self):
        graph = op_graph.build_graph(
            {1: "ttnn.add", 2: "ttnn.deallocate", 3: "TTNN::DEALLOCATE"},
            [GraphEdge(1, 2, 10), GraphEdge(1, 3, 10)],
        )

        assert op_graph.kept_operation_ids(graph) == {1}


class TestOperationsBetween:
    def test_a_diamond_holds_both_branches(self, graph_report):

        assert op_graph.operations_between(_read(graph_report), 1, 4) == {1, 2, 3, 4}

    def test_a_branch_off_the_path_is_left_out(self, graph_report):

        assert op_graph.operations_between(_read(graph_report), 2, 5) == {2, 4, 5}

    def test_no_path_is_empty(self, graph_report):

        assert op_graph.operations_between(_read(graph_report), 2, 3) == set()

    def test_an_operation_to_itself_is_itself(self, graph_report):

        assert op_graph.operations_between(_read(graph_report), 8, 8) == {8}

    def test_a_long_chain_does_not_recurse(self):
        length = 20_000
        graph = op_graph.build_graph(
            {index: "ttnn.add" for index in range(length)},
            [GraphEdge(index, index + 1, index) for index in range(length - 1)],
        )

        assert len(op_graph.operations_between(graph, 0, length - 1)) == length


class TestSubgraphBetween:
    def test_it_lists_the_operations_and_edges_between(self, graph_report):
        registry, handle = graph_report

        result = agent_operations.subgraph_between(registry, handle, 1, 4)

        assert [entry["operation_id"] for entry in result["operations"]] == [1, 2, 3, 4]
        assert result["operations"][1]["name"] == "ttnn.matmul"
        assert result["edges"] == [
            {"source": 1, "target": 2, "tensor_id": 10},
            {"source": 1, "target": 3, "tensor_id": 10},
            {"source": 2, "target": 4, "tensor_id": 11},
            {"source": 3, "target": 4, "tensor_id": 12},
        ]
        assert result["operation_count"] == 4
        assert result["edge_count"] == 4
        assert result["operations_truncated"] is False

    def test_it_lists_each_tensor_once_with_its_layout(self, graph_report):
        registry, handle = graph_report

        result = agent_operations.subgraph_between(registry, handle, 1, 4)

        # Tensor 10 reaches two consumers, and is listed once.
        assert result["tensor_count"] == 3
        assert [entry["tensor_id"] for entry in result["tensors"]] == [10, 11, 12]
        assert result["tensors"][1] == {
            "tensor_id": 11,
            "shape": "Shape([1, 32])",
            "dtype": "DataType.BFLOAT8_B",
            "layout": "Layout.TILE",
            "buffer_type": "L1",
            "memory_layout": "TensorMemoryLayout::HEIGHT_SHARDED",
        }
        assert "size" not in result["tensors"][0]
        assert result["tensors_truncated"] is False

    def test_the_tensor_list_takes_the_limit_and_its_own_lower_cap(self, graph_report):
        registry, handle = graph_report

        limited = agent_operations.subgraph_between(registry, handle, 1, 4, limit=2)
        uncapped = agent_operations.subgraph_between(
            registry, handle, 1, 4, limit=MAX_LIMIT
        )

        assert [entry["tensor_id"] for entry in limited["tensors"]] == [10, 11]
        assert limited["tensors_truncated"] is True
        assert limited["tensor_count"] == 3
        assert len(uncapped["tensors"]) <= MAX_DETAILED_LIMIT

    def test_the_graph_is_read_once_per_handle_and_rank(self, graph_report):
        registry, handle = graph_report

        with patch.object(
            DatabaseQueries,
            "query_producers_consumers",
            autospec=True,
            side_effect=DatabaseQueries.query_producers_consumers,
        ) as read:
            agent_operations.subgraph_between(registry, handle, 1, 4)
            agent_operations.subgraph_between(registry, handle, 2, 5)

        assert read.call_count == 1

    def test_it_refuses_the_wrong_direction_and_says_so(self, graph_report):
        registry, handle = graph_report

        with pytest.raises(ValueError, match="there is one from 1 to 4"):
            agent_operations.subgraph_between(registry, handle, 4, 1)

    def test_it_refuses_unconnected_operations_without_the_hint(self, graph_report):
        registry, handle = graph_report

        with pytest.raises(ValueError, match=r"no path from operation 2 to 3$"):
            agent_operations.subgraph_between(registry, handle, 2, 3)

    def test_it_refuses_an_operation_the_report_lacks(self, graph_report):
        registry, handle = graph_report

        with pytest.raises(ValueError, match="no operation 99"):
            agent_operations.subgraph_between(registry, handle, 1, 99)

    def test_the_limit_caps_each_list_and_not_the_counts(self, graph_report):
        registry, handle = graph_report

        result = agent_operations.subgraph_between(registry, handle, 1, 4, limit=2)

        assert len(result["operations"]) == 2
        assert len(result["edges"]) == 2
        assert result["operations_truncated"] is True
        assert result["edges_truncated"] is True
        assert result["operation_count"] == 4

    def test_a_limit_past_the_cap_is_the_cap(self, graph_report):
        registry, handle = graph_report

        result = agent_operations.subgraph_between(
            registry, handle, 1, 4, limit=MAX_LIMIT + 50
        )

        assert len(result["operations"]) == 4
        assert result["operations_truncated"] is False

    def test_a_deallocate_operation_can_end_the_subgraph(self, graph_report):
        """Unlike `critical_path`, which leaves deallocate operations out."""
        registry, handle = graph_report

        result = agent_operations.subgraph_between(registry, handle, 4, 6)

        assert result["operations"] == [
            {"operation_id": 4, "name": "ttnn.concat"},
            {"operation_id": 6, "name": "ttnn::deallocate"},
        ]

    def test_the_server_routes_it_with_a_link_template(self, graph_report):
        registry, handle = graph_report

        result = server._tool_table(registry)["subgraph_between"]["handler"](
            {"handle": handle, "from_operation_id": "1", "to_operation_id": 4}
        )

        assert result["operation_count"] == 4
        assert "{operation_id}" in result["app_link_template"]


class TestSubgraphBetweenRanks:
    @pytest.mark.parametrize(
        ("rank", "edges"),
        [
            (
                0,
                [
                    {"source": 1, "target": 2, "tensor_id": 10},
                    {"source": 2, "target": 3, "tensor_id": 11},
                ],
            ),
            (1, [{"source": 1, "target": 3, "tensor_id": 10}]),
        ],
    )
    def test_it_reads_the_requested_rank_only(self, tmp_path, rank, edges):
        registry, handle = _load(tmp_path, _RANKED_GRAPH_SQL)

        result = agent_operations.subgraph_between(registry, handle, 1, 3, rank=rank)

        assert result["edges"] == edges
        assert result["rank"] == rank

    def test_a_missing_operation_names_the_rank(self, tmp_path):
        registry, handle = _load(tmp_path, _RANKED_GRAPH_SQL)

        with pytest.raises(ValueError, match="no operation 9 in this report at rank 1"):
            agent_operations.subgraph_between(registry, handle, 1, 9, rank=1)

    @pytest.mark.parametrize("table", ["tensors", "input_tensors", "output_tensors"])
    def test_a_graph_table_without_rank_is_refused(self, tmp_path, table):
        registry, handle = _load(
            tmp_path, _RANKED_GRAPH_SQL + f"ALTER TABLE {table} DROP COLUMN rank;"
        )

        with pytest.raises(agent_operations.UnattributableRankError, match=table):
            agent_operations.subgraph_between(registry, handle, 1, 3)
