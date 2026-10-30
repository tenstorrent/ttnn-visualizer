# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Parity between the agent's critical path and the graph view's. #2174

`op_graph.find_critical_path` restates `findCriticalPath`: the topological pass, the
zero-cost pass-through, the cost-then-length-then-id tie-break and the cycle flag. This
test feeds the port curated and seeded graphs and writes its answers to a golden file,
and `tests/opGraphCriticalPathParity.spec.ts` asserts the app's function gives the same
answers from the same graphs.

Weights are microseconds in multiples of a quarter, so the app's nanoseconds are exact
and an equal-cost tie stays a tie on both sides. Folded blocks have no case: the agent's
graph never folds.

    pnpm run agent:parity-golden    <- regenerates tests/data/opGraphCriticalPathParity.json
"""

import random
from typing import Dict, List, Sequence, Tuple

from ttnn_visualizer.agent.op_graph import (
    GraphEdge,
    build_graph,
    find_critical_path,
    kept_operation_ids,
)
from ttnn_visualizer.tests.parity_golden import Golden

GOLDEN = Golden("opGraphCriticalPathParity")
_SEED = 2174


def _case(
    name: str,
    operation_ids: Sequence[int],
    edges: Sequence[Tuple[int, int]],
    weights: Dict[int, float],
) -> Dict:
    path = find_critical_path(
        list(operation_ids),
        [
            GraphEdge(source, target, index)
            for index, (source, target) in enumerate(edges)
        ],
        weights,
    )
    return {
        "name": name,
        "operation_ids": list(operation_ids),
        "edges": [list(edge) for edge in edges],
        "weights": [[operation_id, weight] for operation_id, weight in weights.items()],
        "expected": {
            "operation_ids": path.operation_ids,
            "total": path.total,
            "has_cycle": path.has_cycle,
        },
    }


def _curated_cases() -> List[Dict]:
    # The cases of tests/opGraphCriticalPath.spec.ts, less the folded block.
    return [
        _case("linear chain", [1, 2, 3], [(1, 2), (2, 3)], {1: 100, 2: 200, 3: 300}),
        _case(
            "two sequential ops beat a heavier side branch",
            [1, 2, 3, 4, 5],
            [(1, 2), (2, 3), (3, 5), (1, 4), (4, 5)],
            {2: 10, 3: 10, 4: 15},
        ),
        _case(
            "equal cost goes to the lower id",
            [1, 2, 3, 4],
            [(1, 2), (2, 4), (1, 3), (3, 4)],
            {2: 10, 3: 10},
        ),
        _case(
            "edge order does not decide",
            [1, 2, 3, 4],
            [(1, 3), (3, 4), (1, 2), (2, 4)],
            {2: 10, 3: 10},
        ),
        _case("sources forwards", [1, 2, 3], [(1, 3), (2, 3)], {1: 10, 2: 10, 3: 5}),
        _case("sources backwards", [3, 2, 1], [(1, 3), (2, 3)], {1: 10, 2: 10, 3: 5}),
        _case("zero-cost pass-through", [1, 2, 3], [(1, 2), (2, 3)], {1: 100, 3: 100}),
        _case(
            "longer chain at equal cost",
            [1, 2, 3, 4],
            [(1, 2), (2, 4), (3, 4)],
            {2: 10, 3: 10},
        ),
        _case("parallel edges", [1, 2], [(1, 2), (1, 2)], {1: 10, 2: 20}),
        _case("edge from a dropped op", [1, 2], [(1, 2), (3, 2)], {1: 10, 2: 20}),
        _case(
            "partial cycle",
            [1, 2, 3, 4],
            [(1, 2), (3, 4), (4, 3)],
            {1: 50, 2: 50, 3: 1000, 4: 1000},
        ),
        _case("every op in a cycle", [1, 2], [(1, 2), (2, 1)], {1: 10, 2: 10}),
        _case("self loop", [1, 2], [(1, 2), (2, 2)], {1: 10, 2: 10}),
        _case("nothing connected", [1, 2, 3], [], {1: 10, 2: 50, 3: 20}),
        _case("empty graph", [], [], {}),
    ]


def _random_cases(rng: random.Random) -> List[Dict]:
    cases = []
    for index in range(40):
        operation_ids = list(range(1, rng.randint(2, 14)))
        # Forward edges only on most cases, so the path is defined; a few back edges
        # on the rest reach the cycle rules.
        edges = [
            (source, target)
            for source in operation_ids
            for target in operation_ids
            if source < target and rng.random() < 0.3
        ]
        if index % 5 == 0 and len(operation_ids) > 2:
            edges.append((operation_ids[-1], rng.choice(operation_ids[:-1])))
        rng.shuffle(edges)
        rng.shuffle(operation_ids)
        weights = {
            operation_id: rng.choice([0.25, 0.5, 1, 1, 2, 3.75, 10])
            for operation_id in operation_ids
            if rng.random() < 0.8
        }
        cases.append(_case(f"seeded {index}", operation_ids, edges, weights))
    return cases


def _kept_case(
    name: str,
    operations: Sequence[Tuple[int, str]],
    edges: Sequence[Tuple[int, int, int]],
) -> Dict:
    graph = build_graph(
        dict(operations),
        [GraphEdge(source, target, tensor_id) for source, target, tensor_id in edges],
    )
    return {
        "name": name,
        "operations": [list(operation) for operation in operations],
        "edges": [list(edge) for edge in edges],
        "expected_kept": sorted(kept_operation_ids(graph)),
    }


def _kept_cases() -> List[Dict]:
    # Which operations the search runs over: `getKeptOperations` with deallocate hidden.
    return [
        _kept_case(
            "diamond with a deallocate and an isolated op",
            [
                (1, "ttnn.from_torch"),
                (2, "ttnn.matmul"),
                (3, "ttnn.add"),
                (4, "ttnn.concat"),
                (5, "ttnn.relu"),
                (6, "ttnn::deallocate"),
                (7, "ttnn.isolated"),
            ],
            [(1, 2, 10), (1, 3, 10), (2, 4, 11), (3, 4, 12), (4, 5, 13), (4, 6, 13)],
        ),
        _kept_case(
            "a neighbour reached only through a deallocate stays",
            [(1, "ttnn.add"), (2, "ttnn.deallocate")],
            [(1, 2, 10)],
        ),
        _kept_case(
            "deallocate names are matched without case",
            [(1, "ttnn.add"), (2, "TTNN.Deallocate"), (3, "TTNN::DEALLOCATE")],
            [(1, 2, 10), (1, 3, 10)],
        ),
        _kept_case("no edges keeps nothing", [(1, "ttnn.add"), (2, "ttnn.relu")], []),
    ]


def _generate_golden() -> Dict:
    return {
        "_comment": (
            "Generated by backend/ttnn_visualizer/tests/test_agent_critical_path_parity.py "
            "from the agent's port. Do not edit by hand; run pnpm run agent:parity-golden."
        ),
        "cases": _curated_cases() + _random_cases(random.Random(_SEED)),
        "kept_cases": _kept_cases(),
    }


def test_the_port_reproduces_the_golden():
    GOLDEN.check(_generate_golden())


def test_the_golden_reaches_the_rules():
    """A golden of easy graphs would never check the tie-break or the cycle flag."""
    cases = _generate_golden()["cases"]
    expected = {case["name"]: case["expected"] for case in cases}

    assert expected["equal cost goes to the lower id"]["operation_ids"] == [1, 2, 4]
    assert expected["sources backwards"]["operation_ids"] == [1, 3]
    assert expected["partial cycle"] == {
        "operation_ids": [1, 2],
        "total": 100,
        "has_cycle": True,
    }
    assert expected["every op in a cycle"]["operation_ids"] == []
    seeded = [case["expected"] for case in cases if case["name"].startswith("seeded")]
    assert any(entry["has_cycle"] for entry in seeded)
    assert any(len(entry["operation_ids"]) >= 4 for entry in seeded)


def test_the_ts_spec_reads_this_golden():
    GOLDEN.check_spec_reads_it()
