// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { buildOpGraph } from '../src/components/operation-graph/opGraphBuilder';
import {
    type OpGraphDeviceSubgraph,
    OpGraphNodeType,
    type OpGraphSourceOperation,
} from '../src/components/operation-graph/opGraphTypes';

interface OperationSpec {
    id: number;
    name?: string;
    outputs?: { label?: string; consumers: number[]; tensorId?: number }[];
    deviceOperationCount?: number;
}

const operation = ({
    id,
    name = `ttnn.op${id}`,
    outputs = [],
    deviceOperationCount = 0,
}: OperationSpec): OpGraphSourceOperation => ({
    id,
    name,
    fileIdentifier: `model.py:${id}`,
    outputs: outputs.map(({ label = '[1, 32]', consumers, tensorId = id * 100 }, index) => ({
        edgeLabel: label,
        consumers,
        tensorId: tensorId + index,
    })),
    deviceOperationCount,
});

const build = (operations: OpGraphSourceOperation[], hideDeallocate: boolean) =>
    buildOpGraph(operations, { hideDeallocate, deviceSubgraphs: [] });

const HEAD_FRAME_ID = 1;
const TAIL_FRAME_ID = 2;

interface SubgraphSpec {
    operationId: number;
    /** The tensor an incoming edge should be handed to the head on. */
    entryTensorId?: number;
    /** The tensor an outgoing edge should be handed to the tail on. */
    exitTensorId?: number;
    hasSingleEnd?: boolean;
}

// A two-node chain, which is the smallest subgraph that can tell an endpoint
// re-targeted to the head apart from one re-targeted to the tail. Hand-built
// rather than derived, so the builder is tested against the payload contract and
// not against the derivation's reading of a frame stream.
const deviceSubgraph = ({
    operationId,
    entryTensorId,
    exitTensorId,
    hasSingleEnd = true,
}: SubgraphSpec): OpGraphDeviceSubgraph => {
    const head = `dev:${operationId}:${HEAD_FRAME_ID}`;
    const tail = `dev:${operationId}:${TAIL_FRAME_ID}`;
    return {
        operationId,
        nodes: [
            { id: head, label: 'HeadDeviceOperation()' },
            { id: tail, label: 'TailDeviceOperation()' },
        ],
        edges: [{ id: `dev-edge:${operationId}:1-2:9`, source: head, target: tail, label: 'T9 [1, 32]' }],
        entryNodeIdByTensorId: entryTensorId === undefined ? {} : { [entryTensorId]: head },
        exitNodeIdByTensorId: exitTensorId === undefined ? {} : { [exitTensorId]: tail },
        entryFallbackNodeId: hasSingleEnd ? head : null,
        exitFallbackNodeId: hasSingleEnd ? tail : null,
    };
};

const buildExpanded = (operations: OpGraphSourceOperation[], deviceSubgraphs: OpGraphDeviceSubgraph[]) =>
    buildOpGraph(operations, { hideDeallocate: true, deviceSubgraphs });

const nodeById = (graph: ReturnType<typeof buildOpGraph>, id: string) => {
    const found = graph.nodes.find((node) => node.id === id);
    expect(found, `node ${id} missing`).toBeDefined();
    return found!;
};

// By the operations an edge joins rather than by its endpoints, which is the only
// lookup that reads the same whether an end is expanded.
const edgeBetweenOperations = (graph: ReturnType<typeof buildOpGraph>, source: number, target: number) => {
    const found = graph.edges.find(
        (edge) => edge.data?.sourceOperationId === source && edge.data?.targetOperationId === target,
    );
    expect(found, `edge ${source} → ${target} missing`).toBeDefined();
    return found!;
};

const operationIdsOf = (graph: ReturnType<typeof buildOpGraph>) => graph.nodes.map((node) => node.data.operationId);

describe('buildOpGraph', () => {
    describe('node membership', () => {
        it('keeps only operations that a tensor connects to something', () => {
            const graph = build(
                [
                    operation({ id: 1, outputs: [{ consumers: [2] }] }),
                    operation({ id: 2 }),
                    operation({ id: 3 }), // Produces nothing and consumes nothing.
                ],
                false,
            );

            expect(operationIdsOf(graph)).toEqual([1, 2]);
        });

        it('labels a node with its id and name, and filters on the bare name', () => {
            const [node] = build(
                [operation({ id: 7, name: 'ttnn.matmul', outputs: [{ consumers: [8] }] })],
                false,
            ).nodes;

            expect(node.id).toBe('7');
            expect(node.data.label).toBe('7 ttnn.matmul');
            expect(node.data.filterString).toBe('ttnn.matmul');
            expect(node.data.fileIdentifier).toBe('model.py:7');
        });
    });

    describe('deallocate filtering', () => {
        // The filter runs after connectivity is decided, so a node's presence
        // never depends on whether its neighbours survived the filter.
        it('keeps an operation whose only neighbour is a hidden deallocate', () => {
            const operations = [
                operation({ id: 1, outputs: [{ consumers: [2] }] }),
                operation({ id: 2, name: 'ttnn.deallocate' }),
            ];

            expect(operationIdsOf(build(operations, false))).toEqual([1, 2]);
            expect(operationIdsOf(build(operations, true))).toEqual([1]);
        });

        it('does not pull in an isolated operation when a deallocate is hidden', () => {
            const graph = build(
                [
                    operation({ id: 1, outputs: [{ consumers: [2] }] }),
                    operation({ id: 2, name: 'ttnn.deallocate' }),
                    operation({ id: 3 }),
                ],
                true,
            );

            expect(operationIdsOf(graph)).toEqual([1]);
        });

        it('drops the edges into a hidden deallocate rather than leaving them dangling', () => {
            const graph = build(
                [
                    operation({ id: 1, outputs: [{ consumers: [2, 3] }] }),
                    operation({ id: 2, name: 'ttnn::deallocate' }),
                    operation({ id: 3 }),
                ],
                true,
            );

            expect(operationIdsOf(graph)).toEqual([1, 3]);
            expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([['1', '3']]);
        });

        it('recognises a deallocate whatever the casing', () => {
            const operations = [
                operation({ id: 1, outputs: [{ consumers: [2] }] }),
                operation({ id: 2, name: 'TTNN.Deallocate' }),
            ];

            expect(operationIdsOf(build(operations, true))).toEqual([1]);
        });
    });

    describe('parallel edges', () => {
        it('gives each edge between the same pair a unique id and a monotonic index', () => {
            const graph = build(
                [
                    operation({
                        id: 1,
                        outputs: [
                            { label: '[1, 32]', consumers: [2] },
                            { label: '[1, 64]', consumers: [2] },
                            { label: '[1, 96]', consumers: [2] },
                        ],
                    }),
                    operation({ id: 2 }),
                ],
                false,
            );

            expect(graph.edges.map((edge) => edge.id)).toEqual(['1-2-0', '1-2-1', '1-2-2']);
            expect(graph.edges.map((edge) => edge.data?.parallelIndex)).toEqual([0, 1, 2]);
            expect(graph.edges.map((edge) => edge.label)).toEqual(['[1, 32]', '[1, 64]', '[1, 96]']);
        });

        it('counts each ordered pair separately, so a cycle starts both sides at zero', () => {
            const graph = build(
                [
                    operation({ id: 1, outputs: [{ consumers: [2] }] }),
                    operation({ id: 2, outputs: [{ consumers: [1] }] }),
                ],
                false,
            );

            expect(graph.edges.map((edge) => edge.id)).toEqual(['1-2-0', '2-1-0']);
        });

        it('emits unique ids across a graph with several parallel pairs', () => {
            const graph = build(
                [
                    operation({ id: 1, outputs: [{ consumers: [2, 2, 3] }] }),
                    operation({ id: 2, outputs: [{ consumers: [3, 3] }] }),
                    operation({ id: 3 }),
                ],
                false,
            );

            expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(graph.edges.length);
        });
    });

    describe('layout', () => {
        it('gives every node a laid-out position rather than the seed origin', () => {
            const graph = build(
                [
                    operation({ id: 1, outputs: [{ consumers: [2] }] }),
                    operation({ id: 2, outputs: [{ consumers: [3] }] }),
                    operation({ id: 3 }),
                ],
                false,
            );

            for (const node of graph.nodes) {
                expect(Number.isFinite(node.position.x)).toBe(true);
                expect(Number.isFinite(node.position.y)).toBe(true);
            }
            // Dagre lays the chain out top-down, so each rank sits below the last.
            const [first, second, third] = graph.nodes;
            expect(second.position.y).toBeGreaterThan(first.position.y);
            expect(third.position.y).toBeGreaterThan(second.position.y);
        });

        it('returns an empty graph for an empty report rather than throwing', () => {
            const graph = build([], true);

            expect(graph.nodes).toEqual([]);
            expect(graph.edges).toEqual([]);
        });
    });

    describe('device operation expansion', () => {
        const CHAIN = [
            operation({ id: 1, outputs: [{ consumers: [2] }] }),
            operation({ id: 2, outputs: [{ consumers: [3] }], deviceOperationCount: 2 }),
            operation({ id: 3 }),
        ];

        it('keeps the operation’s own node id when it expands', () => {
            const graph = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2 })]);

            // Everything keyed by node id — perf styles, the critical-path set,
            // focus, selection — then needs no notion of expansion.
            expect(nodeById(graph, '2').type).toBe(OpGraphNodeType.DEVICE_GROUP);
            expect(nodeById(graph, '2').data.operationId).toBe(2);
        });

        it('parents the device operations to the operation and pens them in', () => {
            const graph = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2 })]);

            const children = graph.nodes.filter((node) => node.type === OpGraphNodeType.DEVICE_OP);
            expect(children.map((node) => node.id)).toEqual(['dev:2:1', 'dev:2:2']);
            for (const child of children) {
                expect(child.parentId).toBe('2');
                expect(child.extent).toBe('parent');
                // The owning operation, so a click on a child answers about it.
                expect(child.data.operationId).toBe(2);
            }
        });

        it('emits every child after its parent', () => {
            const graph = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2 })]);

            // React Flow resolves `parentId` against the nodes it has already seen;
            // a child ahead of its parent renders at the pane origin.
            const parentIndex = graph.nodes.findIndex((node) => node.id === '2');
            const firstChildIndex = graph.nodes.findIndex((node) => node.type === OpGraphNodeType.DEVICE_OP);
            expect(firstChildIndex).toBeGreaterThan(parentIndex);
        });

        it('lands an incoming edge on the device operation that consumes the tensor', () => {
            // Op 1's only output tensor, which is what the edge into op 2 carries.
            const graph = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2, entryTensorId: 100 })]);

            expect(edgeBetweenOperations(graph, 1, 2).target).toBe('dev:2:1');
            expect(edgeBetweenOperations(graph, 1, 2).source).toBe('1');
        });

        it('leaves an outgoing edge from the device operation that produced the tensor', () => {
            const graph = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2, exitTensorId: 200 })]);

            expect(edgeBetweenOperations(graph, 2, 3).source).toBe('dev:2:2');
            expect(edgeBetweenOperations(graph, 2, 3).target).toBe('3');
        });

        it('falls back to the single end when no device operation claims the tensor', () => {
            // The usual case outbound: the operation's result is registered by the
            // enclosing `ttnn.` frame, so no drawn frame produced that tensor.
            const graph = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2 })]);

            expect(edgeBetweenOperations(graph, 1, 2).target).toBe('dev:2:1');
            expect(edgeBetweenOperations(graph, 2, 3).source).toBe('dev:2:2');
        });

        it('stops at the boundary rather than guessing between two ends', () => {
            const graph = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2, hasSingleEnd: false })]);

            expect(edgeBetweenOperations(graph, 1, 2).target).toBe('2');
            expect(edgeBetweenOperations(graph, 2, 3).source).toBe('2');
        });

        it('records the operations an edge joins, whatever its endpoints became', () => {
            const graph = buildExpanded(CHAIN, [
                deviceSubgraph({ operationId: 2, entryTensorId: 100, exitTensorId: 200 }),
            ]);

            const incoming = edgeBetweenOperations(graph, 1, 2);
            expect([incoming.data?.sourceOperationId, incoming.data?.targetOperationId]).toEqual([1, 2]);
        });

        it('marks an edge inside one operation with that operation at both ends', () => {
            const graph = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2 })]);

            const internal = graph.edges.find((edge) => edge.source === 'dev:2:1');
            expect(internal?.target).toBe('dev:2:2');
            // What tells the critical path and the I/O highlight that this is not
            // a relation between two operations.
            expect(internal?.data?.sourceOperationId).toBe(2);
            expect(internal?.data?.targetOperationId).toBe(2);
        });

        // Dagre drops edges whose endpoints it has no node for, so handing it the
        // re-targeted endpoints would lose the dependency and rank 1, 2 and 3
        // together — with every edge then drawn across a single row.
        it('still ranks an expanded operation between its neighbours', () => {
            const graph = buildExpanded(CHAIN, [
                deviceSubgraph({ operationId: 2, entryTensorId: 100, exitTensorId: 200 }),
            ]);

            const [first, second, third] = ['1', '2', '3'].map((id) => nodeById(graph, id).position.y);
            expect(second).toBeGreaterThan(first);
            expect(third).toBeGreaterThan(second);
        });

        it('sizes the group from its contents rather than from its label', () => {
            const collapsed = buildExpanded(CHAIN, []);
            const expanded = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2 })]);

            expect(nodeById(expanded, '2').height!).toBeGreaterThan(nodeById(collapsed, '2').height!);
            // Strictly wider, and only because the child labels are longer than the
            // operation's own: `layoutDeviceSubgraph` floors the group at the header
            // width, so `toBeGreaterThanOrEqual` here could not have failed.
            expect(nodeById(expanded, '2').width!).toBeGreaterThan(nodeById(collapsed, '2').width!);
        });
    });

    describe('expander badge', () => {
        it('reserves room for the badge on an operation that can expand', () => {
            const withBadge = build(
                [operation({ id: 1, outputs: [{ consumers: [2] }], deviceOperationCount: 2 })],
                false,
            ).nodes[0];
            const withoutBadge = build([operation({ id: 1, outputs: [{ consumers: [2] }] })], false).nodes[0];

            // Absolutely positioned, so the box has to be widened for it or the
            // badge lands on the label of a node sized to that label alone.
            expect(withBadge.width!).toBeGreaterThan(withoutBadge.width!);
        });

        it('reserves nothing for an operation whose single device op draws no badge', () => {
            const single = build([operation({ id: 1, outputs: [{ consumers: [2] }], deviceOperationCount: 1 })], false)
                .nodes[0];
            const none = build([operation({ id: 1, outputs: [{ consumers: [2] }] })], false).nodes[0];

            expect(single.width).toBe(none.width);
        });
    });
});
