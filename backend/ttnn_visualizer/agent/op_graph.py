# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The operation graph as a whole: one edge per tensor, from its producer to each consumer.

`tensor_flow` answers one tensor at a time, which leaves an agent walking the graph call
by call for any question about its shape (#2174). This module reads every edge at once
and answers over all of them.

`find_critical_path` is a port of `findCriticalPath`
(`src/components/operation-graph/opGraphCriticalPath.ts`), and `kept_operation_ids` of
`getKeptOperations` (`opGraphBuilder.ts`) with deallocate ops hidden, as the graph view
hides them by default. The `opGraphCriticalPathParity` golden holds the first to the app;
mirror a change on either side, then `pnpm run agent:parity-golden`.
"""

from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Dict, FrozenSet, Iterable, List, Mapping, Optional, Sequence, Set

from ttnn_visualizer.agent.l1_peak import DEALLOCATE_OPERATION_NAMES
from ttnn_visualizer.queries import DatabaseQueries


@dataclass(frozen=True)
class GraphEdge:
    source: int
    target: int
    tensor_id: int


@dataclass(frozen=True)
class OpGraph:
    names: Dict[int, str]
    edges: List[GraphEdge]
    outgoing: Dict[int, List[GraphEdge]] = field(default_factory=dict)
    incoming: Dict[int, List[GraphEdge]] = field(default_factory=dict)


def build_graph(names: Mapping[int, str], edges: Iterable[GraphEdge]) -> OpGraph:
    """An edge whose endpoint is not one of `names` is dropped, as `buildOpGraph` drops
    an edge to an operation it did not keep."""
    kept = [edge for edge in edges if edge.source in names and edge.target in names]
    outgoing: Dict[int, List[GraphEdge]] = defaultdict(list)
    incoming: Dict[int, List[GraphEdge]] = defaultdict(list)
    for edge in kept:
        outgoing[edge.source].append(edge)
        incoming[edge.target].append(edge)
    return OpGraph(dict(names), kept, dict(outgoing), dict(incoming))


def read_graph(
    queries: DatabaseQueries, operations_filter: Dict[str, object], rank: Optional[int]
) -> OpGraph:
    """Every operation in scope and every producer-to-consumer edge between them.

    Tensors are not parsed: an edge needs only their ids, and building a `Tensor`
    parses its memory config.
    """
    names = {
        operation.operation_id: operation.name
        for operation in queries.query_operations(filters=operations_filter)
    }
    edges = [
        GraphEdge(producer, consumer, link.tensor_id)
        for link in queries.query_producers_consumers(rank=rank)
        for producer in link.producers
        for consumer in link.consumers
    ]
    return build_graph(names, edges)


def kept_operation_ids(graph: OpGraph) -> FrozenSet[int]:
    """`getKeptOperations` with `hideDeallocate`, the graph view's default.

    Connectivity is decided before deallocate ops go, as there, so hiding them never
    drops a neighbour that was only connected through one.
    """
    connected = {edge.source for edge in graph.edges} | {
        edge.target for edge in graph.edges
    }
    return frozenset(
        operation_id
        for operation_id in connected
        if graph.names.get(operation_id, "").lower() not in DEALLOCATE_OPERATION_NAMES
    )


@dataclass(frozen=True)
class CriticalPath:
    # Source to sink.
    operation_ids: List[int]
    total: float
    # A cycle leaves its members and everything downstream of them unordered, so the
    # path covers the acyclic portion only and the total understates.
    has_cycle: bool


EMPTY_CRITICAL_PATH = CriticalPath([], 0.0, False)


def _is_preferred_chain(cost_delta: float, count_delta: int, id_delta: int) -> bool:
    """Cost, then chain length, then operation id: `isPreferredChain`.

    The relaxation and the end-node scan both decide through this one comparator,
    because the result only stays independent of input order while they agree.
    """
    return cost_delta > 0 or (
        cost_delta == 0 and (count_delta > 0 or (count_delta == 0 and id_delta < 0))
    )


def find_critical_path(
    operation_ids: Sequence[int],
    edges: Sequence[GraphEdge],
    weight_by_id: Mapping[int, float],
) -> CriticalPath:
    """Longest cumulative-weight path, where weight is carried by the operations.

    An operation with no weight costs 0 and stays traversable, so a gap in the
    performance report shortens the total rather than severing the path. The app's
    folded blocks (`memberOperationIds`) have no equivalent here: this graph never
    folds, so every node is one operation.
    """
    if not operation_ids:
        return EMPTY_CRITICAL_PATH

    in_degree = {operation_id: 0 for operation_id in operation_ids}
    outgoing: Dict[int, List[GraphEdge]] = defaultdict(list)
    for edge in edges:
        # An unmatched target would sit in-degree bound and read as a cycle.
        if edge.source in in_degree and edge.target in in_degree:
            outgoing[edge.source].append(edge)
            in_degree[edge.target] += 1

    weight = {
        operation_id: weight_by_id.get(operation_id, 0.0)
        for operation_id in operation_ids
    }
    cost = dict(weight)
    count = {operation_id: 1 for operation_id in operation_ids}
    predecessor: Dict[int, int] = {}

    # Sources in input order: every tie settles on operation id, so sorting them
    # would buy nothing, as the app's comment says.
    order = [
        operation_id for operation_id in operation_ids if in_degree[operation_id] == 0
    ]
    head = 0
    while head < len(order):
        node = order[head]
        head += 1
        for edge in outgoing.get(node, []):
            target = edge.target
            candidate_cost = cost[node] + weight[target]
            candidate_count = count[node] + 1
            current = predecessor.get(target)
            if _is_preferred_chain(
                candidate_cost - cost[target],
                candidate_count - count[target],
                # A target without a predecessor holds its own single operation,
                # always shorter than the chain arriving, so the id never decides.
                0 if current is None else node - current,
            ):
                cost[target] = candidate_cost
                count[target] = candidate_count
                predecessor[target] = node
            in_degree[target] -= 1
            if in_degree[target] == 0:
                order.append(target)

    if not order:
        return CriticalPath([], 0.0, True)

    end = order[0]
    for node in order:
        if _is_preferred_chain(
            cost[node] - cost[end], count[node] - count[end], node - end
        ):
            end = node

    path: List[int] = []
    step: Optional[int] = end
    while step is not None:
        path.append(step)
        step = predecessor.get(step)
    path.reverse()
    return CriticalPath(path, cost[end], len(order) < len(operation_ids))


def _reachable(
    start: int, neighbours: Mapping[int, List[GraphEdge]], forwards: bool
) -> Set[int]:
    # Iterative: a report holds 10^4 operations, past Python's recursion limit.
    seen = {start}
    queue = deque([start])
    while queue:
        node = queue.popleft()
        for edge in neighbours.get(node, []):
            nxt = edge.target if forwards else edge.source
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen


def operations_between(graph: OpGraph, source: int, target: int) -> Set[int]:
    """Every operation on some path from `source` to `target`; empty when none exists."""
    if source not in graph.names or target not in graph.names:
        return set()
    if source == target:
        return {source}
    downstream = _reachable(source, graph.outgoing, forwards=True)
    if target not in downstream:
        return set()
    return downstream & _reachable(target, graph.incoming, forwards=False)


__all__ = [
    "EMPTY_CRITICAL_PATH",
    "CriticalPath",
    "GraphEdge",
    "OpGraph",
    "build_graph",
    "find_critical_path",
    "kept_operation_ids",
    "operations_between",
    "read_graph",
]
