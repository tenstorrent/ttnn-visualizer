# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The operation graph as a whole: `agent/op_graph.py` and `subgraph_between`. #2174

What the critical path golden does not reach: how the graph is read from the
database, which operations the graph view keeps, and the paths between two
operations. The search itself is held by `test_agent_critical_path_parity.py`.
"""

import sqlite3

import pytest
from ttnn_visualizer.agent import op_graph
from ttnn_visualizer.agent import operations as agent_operations
from ttnn_visualizer.agent.bounds import MAX_LIMIT
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.agent.op_graph import GraphEdge

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
    (11, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL),
    (12, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL),
    (13, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL),
    (14, 'Shape([1])', 'DataType.BFLOAT16', 'Layout.TILE', '', 0, NULL, NULL);

INSERT INTO output_tensors VALUES (1, 0, 10), (2, 0, 11), (3, 0, 12), (4, 0, 13);
INSERT INTO input_tensors VALUES
    (2, 0, 10), (3, 0, 10), (4, 0, 11), (4, 1, 12), (5, 0, 13), (6, 0, 13), (7, 0, 14);
"""


@pytest.fixture
def graph_report(tmp_path):
    directory = tmp_path / "profiler"
    directory.mkdir()
    connection = sqlite3.connect(directory / "db.sqlite")
    try:
        connection.executescript(_GRAPH_SQL)
        connection.commit()
    finally:
        connection.close()
    registry = ReportRegistry()
    handle = load_report(registry, profiler_path=str(directory))["handle"]
    return registry, handle


def _read(report) -> op_graph.OpGraph:
    registry, handle = report
    with agent_operations.profiler_db(registry.get(handle)) as queries:
        scope = agent_operations.rank_scope(queries, None)
        return agent_operations.read_scoped_graph(queries, scope)


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

        assert result["operation_count"] == 4
