// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDeviceEdgeId, getDeviceNodeId } from '../src/components/operation-graph/opGraphDeviceSubgraph';
import { formatBlockMeta } from '../src/components/operation-graph/opGraphBlockMeta';
import { buildOpGraph } from '../src/components/operation-graph/opGraphBuilder';
import { OpGraphBlockKind, OpGraphGrouping } from '../src/components/operation-graph/opGraphTypes';
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
    durationSeconds?: number;
    memoryDeltaBytes?: number;
}

const operation = ({
    id,
    name = `ttnn.op${id}`,
    outputs = [],
    deviceOperationCount = 0,
    durationSeconds,
    memoryDeltaBytes,
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
    durationSeconds,
    memoryDeltaBytes,
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
    const head = getDeviceNodeId(operationId, HEAD_FRAME_ID);
    const tail = getDeviceNodeId(operationId, TAIL_FRAME_ID);
    return {
        operationId,
        nodes: [
            { id: head, label: 'HeadDeviceOperation()' },
            { id: tail, label: 'TailDeviceOperation()' },
        ],
        edges: [
            {
                id: getDeviceEdgeId(operationId, HEAD_FRAME_ID, TAIL_FRAME_ID, 9),
                source: head,
                target: tail,
                label: 'T9 [1, 32]',
            },
        ],
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

        it('uses the candidate edges it was handed instead of walking them again', () => {
            // The walk is ops x outputs x consumers and the worker already runs it once
            // per source for detection, so it hands the same pass over rather than
            // making every uncached layout — every frame of an op-range drag — repeat it.
            // Proved by supplying a set that omits a real edge: if the build recollected,
            // ops 3 and 4 would be connected and drawn.
            const operations = [
                operation({ id: 1, outputs: [{ consumers: [2] }] }),
                operation({ id: 2 }),
                operation({ id: 3, outputs: [{ consumers: [4] }] }),
                operation({ id: 4 }),
            ];
            const graph = buildOpGraph(operations, {
                hideDeallocate: false,
                deviceSubgraphs: [],
                candidates: [{ source: 1, target: 2, label: '[1, 32]', tensorId: 1 }],
            });

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
            expect(children.map((node) => node.id)).toEqual([
                getDeviceNodeId(2, HEAD_FRAME_ID),
                getDeviceNodeId(2, TAIL_FRAME_ID),
            ]);
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

            expect(edgeBetweenOperations(graph, 1, 2).target).toBe(getDeviceNodeId(2, HEAD_FRAME_ID));
            expect(edgeBetweenOperations(graph, 1, 2).source).toBe('1');
        });

        it('leaves an outgoing edge from the device operation that produced the tensor', () => {
            const graph = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2, exitTensorId: 200 })]);

            expect(edgeBetweenOperations(graph, 2, 3).source).toBe(getDeviceNodeId(2, TAIL_FRAME_ID));
            expect(edgeBetweenOperations(graph, 2, 3).target).toBe('3');
        });

        it('falls back to the single end when no device operation claims the tensor', () => {
            // The usual case outbound: the operation's result is registered by the
            // enclosing `ttnn.` frame, so no drawn frame produced that tensor.
            const graph = buildExpanded(CHAIN, [deviceSubgraph({ operationId: 2 })]);

            expect(edgeBetweenOperations(graph, 1, 2).target).toBe(getDeviceNodeId(2, HEAD_FRAME_ID));
            expect(edgeBetweenOperations(graph, 2, 3).source).toBe(getDeviceNodeId(2, TAIL_FRAME_ID));
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

            const internal = graph.edges.find((edge) => edge.source === getDeviceNodeId(2, HEAD_FRAME_ID));
            expect(internal?.target).toBe(getDeviceNodeId(2, TAIL_FRAME_ID));
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

    describe('block kinds', () => {
        it('marks a repeat, a layer and a weight fan with different classes', () => {
            // The three detectors all render the same node type, so without this the only
            // way to tell them apart is to read the labels. #1982
            // Prefix and suffix included: the window scan needs the run to be bounded
            // before it reads as a repeat.
            const repeats = buildOpGraph(
                [
                    operation({ id: 1, name: 'prefix', outputs: [{ consumers: [2] }] }),
                    operation({ id: 2, name: 'layer_a', outputs: [{ consumers: [3] }] }),
                    operation({ id: 3, name: 'layer_b', outputs: [{ consumers: [4] }] }),
                    operation({ id: 4, name: 'layer_a', outputs: [{ consumers: [5] }] }),
                    operation({ id: 5, name: 'layer_b', outputs: [{ consumers: [6] }] }),
                    operation({ id: 6, name: 'suffix' }),
                ],
                { hideDeallocate: false, deviceSubgraphs: [], expandedBlockIds: [] },
            );
            const layers = buildOpGraph(
                [
                    operation({
                        id: 1,
                        name: 'ttnn.transformer.scaled_dot_product_attention',
                        outputs: [{ consumers: [2] }],
                    }),
                    operation({ id: 2, name: 'ttnn.layer_norm' }),
                ],
                {
                    hideDeallocate: false,
                    deviceSubgraphs: [],
                    expandedBlockIds: [],
                    grouping: OpGraphGrouping.LAYERS,
                },
            );
            const fans = buildOpGraph(
                [
                    operation({ id: 1, name: 'ttnn.to_device', outputs: [{ consumers: [3] }] }),
                    operation({ id: 2, name: 'ttnn.to_device', outputs: [{ consumers: [3] }] }),
                    operation({ id: 3, name: 'ttnn.linear', outputs: [{ consumers: [4] }] }),
                    operation({ id: 4, name: 'ttnn.layer_norm' }),
                ],
                { hideDeallocate: false, deviceSubgraphs: [], collapseWeightLoads: true },
            );

            const classOf = (graph: ReturnType<typeof buildOpGraph>, id: string) =>
                graph.nodes.find((node) => node.id === id)?.className;

            expect(classOf(repeats, 'block:2')).toBe('op-graph-block-repeat');
            expect(classOf(layers, 'layer:attention:1')).toBe('op-graph-block-layer');
            expect(classOf(fans, 'weights:1-2')).toBe('op-graph-block-weights');
        });

        it('gives every kind of block an expander pill that matches its own border', () => {
            // Overrides were added for layer and weights and not for repeat, so a repeat
            // pill kept the legacy `--graph-block-border` while its ring had moved to
            // `--graph-block-repeat-border` — a different blue. Asserted through the
            // class, since the stylesheet is what carries the colour. #1982
            const stylesheet = readFileSync('src/scss/components/OperationGraphReactFlow.scss', 'utf8');

            for (const kind of ['repeat', 'layer', 'weights']) {
                expect(stylesheet).toContain(
                    `.react-flow__node-blockNode.op-graph-block-${kind} > .op-graph-node-expander`,
                );
            }
        });

        it('lets the I/O highlight outrank the kind colour on a block', () => {
            // The kind rules match the shared I/O rule on specificity (three classes
            // each), so source order decides, and the shared rule sits higher up the
            // file: a block that was an input or output of the selection silently kept
            // its own fill and dropped a highlight that shipped with #1195. The block
            // rule carries its own I/O override, and it has to stay below the three kind
            // rules for that to hold. #1982
            const stylesheet = readFileSync('src/scss/components/OperationGraphReactFlow.scss', 'utf8');
            const lastKindRule = Math.max(
                ...['repeat', 'layer', 'weights'].map((kind) => stylesheet.indexOf(`&.op-graph-block-${kind} {`)),
            );

            for (const relation of ['input', 'output']) {
                const override = stylesheet.indexOf(`&.op-graph-node-${relation} {`);
                expect(override).toBeGreaterThan(lastKindRule);
            }
        });

        describe('a folded block says how much of it is weight loading (#2028)', () => {
            // A block handed in rather than detected: what is being pinned is what a
            // block reports about the operations it holds, not which detector put
            // them there. Two loaders sit inside it, so folding absorbs them and
            // `Collapse weight loads` has nothing left to draw -- the silent no-op
            // this exists for.
            const CLAIMED = [
                operation({ id: 1, name: 'ttnn.to_device', outputs: [{ consumers: [11] }] }),
                operation({ id: 2, name: 'ttnn.to_device', outputs: [{ consumers: [11] }] }),
                operation({ id: 11, name: 'ttnn.linear', outputs: [{ consumers: [12] }] }),
                operation({ id: 12, name: 'ttnn.relu' }),
            ];
            const blockOver = (operationIds: number[]) => [
                {
                    kind: OpGraphBlockKind.LAYER,
                    instanceId: 'layer:attention:1',
                    patternId: 'layer:attention',
                    label: 'Attention',
                    patternLabel: 'Attention',
                    operationIds,
                    instanceIndex: 0,
                    instanceCount: 1,
                },
            ];
            const metaOf = (collapseWeightLoads: boolean) => {
                const graph = buildOpGraph(CLAIMED, {
                    hideDeallocate: false,
                    deviceSubgraphs: [],
                    collapseWeightLoads,
                    detectedBlocks: blockOver([1, 2, 11, 12]),
                    expandedBlockIds: [],
                });
                expect(
                    graph.nodes.some((node) => node.id.startsWith('weights:')),
                    'the fold should have absorbed every fan',
                ).toBe(false);
                return nodeById(graph, 'layer:attention:1').data.metaLine;
            };

            it('counts the weight loads the fold absorbed', () => {
                expect(metaOf(true)).toContain('(2 weight)');
            });

            it('says nothing about weights when the feature is off', () => {
                // Off, the reader is not thinking in weight loads and the word would
                // arrive unexplained.
                expect(metaOf(false)).not.toContain('weight');
            });

            it('counts operations nothing feeds, not fan membership', () => {
                // A source with two consumers never becomes a fan -- it belongs to
                // neither -- but it is still a weight load sitting in the block, so
                // the count is a superset of what unrolling would pill up.
                const shared = [
                    operation({ id: 1, name: 'ttnn.to_device', outputs: [{ consumers: [11, 12] }] }),
                    operation({ id: 11, name: 'ttnn.linear', outputs: [{ consumers: [12] }] }),
                    operation({ id: 12, name: 'ttnn.relu' }),
                ];
                const graph = buildOpGraph(shared, {
                    hideDeallocate: false,
                    deviceSubgraphs: [],
                    collapseWeightLoads: true,
                    detectedBlocks: blockOver([1, 11, 12]),
                    expandedBlockIds: [],
                });

                expect(graph.nodes.some((node) => node.id.startsWith('weights:'))).toBe(false);
                expect(nodeById(graph, 'layer:attention:1').data.metaLine).toContain('(1 weight)');
            });

            it('does not restate the count on a weight fan itself', () => {
                // Every member of a fan is one, so `3 ops (3 weight)` says it twice.
                const fanned = buildOpGraph(
                    [
                        operation({ id: 1, name: 'ttnn.to_device', outputs: [{ consumers: [4] }] }),
                        operation({ id: 2, name: 'ttnn.to_device', outputs: [{ consumers: [4] }] }),
                        operation({ id: 4, name: 'ttnn.linear', outputs: [{ consumers: [5] }] }),
                        operation({ id: 5, name: 'ttnn.layer_norm' }),
                    ],
                    { hideDeallocate: false, deviceSubgraphs: [], collapseWeightLoads: true },
                );

                expect(nodeById(fanned, 'weights:1-2').data.metaLine).not.toContain('weight)');
            });
        });

        it('keeps a fan unrolled when a grouping fold merges it with another', () => {
            // Membership is fold-dependent: the members are grouped by the node they
            // feed, so folding two consumers into one block makes one fan out of two.
            // The reader who unrolled `weights:2-3` gets a fan called `weights:1-2-3`
            // back, which their decision does not name — so it re-folded under them,
            // and the id they had opened was stranded in a set nothing prunes. #1988
            const chain = [
                operation({ id: 1, name: 'ttnn.to_device', outputs: [{ consumers: [11] }] }),
                operation({ id: 2, name: 'ttnn.to_device', outputs: [{ consumers: [12] }] }),
                operation({ id: 3, name: 'ttnn.to_device', outputs: [{ consumers: [12] }] }),
                operation({ id: 11, name: 'ttnn.linear', outputs: [{ consumers: [12] }] }),
                operation({ id: 12, name: 'ttnn.relu', outputs: [{ consumers: [21] }] }),
                operation({ id: 21, name: 'ttnn.linear', outputs: [{ consumers: [22] }] }),
                operation({ id: 22, name: 'ttnn.relu', outputs: [{ consumers: [30] }] }),
                operation({ id: 30, name: 'ttnn.softmax' }),
            ];
            const buildChain = (expandedBlockIds?: string[]) =>
                buildOpGraph(chain, {
                    hideDeallocate: true,
                    deviceSubgraphs: [],
                    collapseWeightLoads: true,
                    grouping: OpGraphGrouping.REPEATS,
                    ...(expandedBlockIds === undefined ? {} : { expandedBlockIds }),
                });
            const fanIds = (graph: ReturnType<typeof buildOpGraph>) =>
                graph.nodes.filter((node) => node.id.startsWith('weights:')).map((node) => node.id);
            const drawsOperation = (graph: ReturnType<typeof buildOpGraph>, id: string) =>
                graph.nodes.some((node) => node.id === id);

            // Ops 11 and 12 render apart, so 2 and 3 are one fan and 1 is a singleton.
            expect(fanIds(buildChain())).toEqual(['weights:2-3']);

            // The reader opens it, then folds the grouping blocks — which merges the
            // two consumers into one node and so merges the fans.
            const merged = buildChain(['weights:2-3']);

            // The members stay on screen: the merged fan inherits the decision that
            // covers them rather than folding itself over the top of it. The fan id is
            // still drawn — as the container holding them, which is what carries the
            // fold affordance now. #2028
            expect(fanIds(merged)).toEqual(['weights:1-2-3']);
            expect(drawsOperation(merged, '2')).toBe(true);
            expect(drawsOperation(merged, '3')).toBe(true);
            // And op 1, which joined the merge, comes with them rather than being
            // stranded inside a fan node that no longer exists.
            expect(drawsOperation(merged, '1')).toBe(true);
        });

        it('folds a merged fan for a reader who has not opened any of it', () => {
            // The other direction, so the carry cannot be "always unrolled": a
            // decision naming a different fan entirely leaves this one folded.
            const chain = [
                operation({ id: 1, name: 'ttnn.to_device', outputs: [{ consumers: [11] }] }),
                operation({ id: 2, name: 'ttnn.to_device', outputs: [{ consumers: [12] }] }),
                operation({ id: 3, name: 'ttnn.to_device', outputs: [{ consumers: [12] }] }),
                operation({ id: 11, name: 'ttnn.linear', outputs: [{ consumers: [12] }] }),
                operation({ id: 12, name: 'ttnn.relu', outputs: [{ consumers: [21] }] }),
                operation({ id: 21, name: 'ttnn.linear', outputs: [{ consumers: [22] }] }),
                operation({ id: 22, name: 'ttnn.relu', outputs: [{ consumers: [30] }] }),
                operation({ id: 30, name: 'ttnn.softmax' }),
            ];
            const merged = buildOpGraph(chain, {
                hideDeallocate: true,
                deviceSubgraphs: [],
                collapseWeightLoads: true,
                grouping: OpGraphGrouping.REPEATS,
                expandedBlockIds: ['weights:99-100'],
            });

            expect(merged.nodes.filter((node) => node.id.startsWith('weights:')).map((n) => n.id)).toEqual([
                'weights:1-2-3',
            ]);
        });

        it('leaves a fan folded when a remembered decision merely shares a member', () => {
            // The carry is containment, not intersection, and this is the difference.
            // Ops 1 and 2 fed different consumers, the reader opened neither, and a
            // later fold puts 1 alongside 7 and 8 — sources belonging to a fan they
            // left folded. Sharing operation 1 is not "the fan I opened became this
            // one", and unrolling on it would show weight loads nobody asked for.
            const chain = [
                operation({ id: 1, name: 'ttnn.to_device', outputs: [{ consumers: [10] }] }),
                operation({ id: 7, name: 'ttnn.to_device', outputs: [{ consumers: [10] }] }),
                operation({ id: 8, name: 'ttnn.to_device', outputs: [{ consumers: [10] }] }),
                operation({ id: 10, name: 'ttnn.linear' }),
            ];

            const merged = buildOpGraph(chain, {
                hideDeallocate: false,
                deviceSubgraphs: [],
                collapseWeightLoads: true,
                expandedBlockIds: ['weights:1-2'],
            });

            expect(merged.nodes.filter((node) => node.id.startsWith('weights:')).map((n) => n.id)).toEqual([
                'weights:1-7-8',
            ]);
        });

        it('keeps a fan unrolled when a fold splits it into smaller ones', () => {
            // The other direction of the same rule: unfolding a grouping block breaks
            // one fan into several, and each piece is still part of what was opened.
            const chain = [
                operation({ id: 1, name: 'ttnn.to_device', outputs: [{ consumers: [10] }] }),
                operation({ id: 2, name: 'ttnn.to_device', outputs: [{ consumers: [10] }] }),
                operation({ id: 10, name: 'ttnn.linear' }),
            ];

            const split = buildOpGraph(chain, {
                hideDeallocate: false,
                deviceSubgraphs: [],
                collapseWeightLoads: true,
                expandedBlockIds: ['weights:1-2-3-4'],
            });

            // The surviving fan id is the container around the members, not a folded
            // pill over the top of them — the members are still drawn. #2028
            expect(split.nodes.filter((node) => node.id.startsWith('weights:')).map((node) => node.id)).toEqual([
                'weights:1-2',
            ]);
            expect(split.nodes.some((node) => node.id === '1')).toBe(true);
            expect(split.nodes.some((node) => node.id === '2')).toBe(true);
        });

        it('carries the kind on the node data as well as the class', () => {
            // The class paints it; the kind is what a panel or a test can reason about
            // without parsing a string.
            const fans = buildOpGraph(
                [
                    operation({ id: 1, name: 'ttnn.to_device', outputs: [{ consumers: [3] }] }),
                    operation({ id: 2, name: 'ttnn.to_device', outputs: [{ consumers: [3] }] }),
                    operation({ id: 3, name: 'ttnn.linear' }),
                ],
                { hideDeallocate: false, deviceSubgraphs: [], collapseWeightLoads: true },
            );

            expect(nodeById(fans, 'weights:1-2').data.blockKind).toBe(OpGraphBlockKind.WEIGHTS);
        });
    });

    describe('weight-load fans', () => {
        // Three loaders feeding one consumer, plus a downstream op so the consumer is
        // not itself a source.
        const FAN_CHAIN = [
            operation({ id: 1, name: 'ttnn.to_device', outputs: [{ label: '[1, 768]', consumers: [4] }] }),
            operation({ id: 2, name: 'ttnn.to_device', outputs: [{ label: '[768, 3072]', consumers: [4] }] }),
            operation({ id: 3, name: 'ttnn.to_device', outputs: [{ label: '[1, 3072]', consumers: [4] }] }),
            operation({ id: 4, name: 'ttnn.linear', outputs: [{ consumers: [5] }] }),
            operation({ id: 5, name: 'ttnn.layer_norm' }),
        ];

        const FAN_ID = 'weights:1-2-3';

        it('draws one node for the fan and keeps its consumer', () => {
            const graph = buildOpGraph(FAN_CHAIN, {
                hideDeallocate: false,
                deviceSubgraphs: [],
                collapseWeightLoads: true,
            });

            expect(graph.nodes.map((node) => node.id)).toEqual([FAN_ID, '4', '5']);
            expect(nodeById(graph, FAN_ID).data.filterString).toBe('3 weight loads');
        });

        it('joins the fan to its consumer with a single unlabelled edge', () => {
            // Three tensors of different shapes between the same two nodes are one
            // dependency drawn once. The labels would be three shapes on one line. #1980
            const graph = buildOpGraph(FAN_CHAIN, {
                hideDeallocate: false,
                deviceSubgraphs: [],
                collapseWeightLoads: true,
            });
            const intoConsumer = graph.edges.filter((edge) => edge.target === '4');

            expect(intoConsumer).toHaveLength(1);
            expect(intoConsumer[0].source).toBe(FAN_ID);
            expect(intoConsumer[0].label).toBeUndefined();
        });

        it('leaves every member and its labelled edge when switched off', () => {
            const graph = buildOpGraph(FAN_CHAIN, { hideDeallocate: false, deviceSubgraphs: [] });

            expect(graph.nodes.map((node) => node.id)).toEqual(['1', '2', '3', '4', '5']);
            expect(graph.edges.filter((edge) => edge.target === '4')).toHaveLength(3);
            expect(edgeBetweenOperations(graph, 2, 4).label).toBe('[768, 3072]');
        });

        it('unfolds a fan the expansion set names', () => {
            // The reported bug: the expander pill rendered and clicking it did nothing,
            // because the fan was rebuilt and folded regardless of what had been asked
            // for. #1980
            const graph = buildOpGraph(FAN_CHAIN, {
                hideDeallocate: false,
                deviceSubgraphs: [],
                collapseWeightLoads: true,
                expandedBlockIds: [FAN_ID],
            });

            // Members last, behind the container that now holds them: React Flow
            // resolves `parentId` against nodes it has already seen. #2028
            expect(graph.nodes.map((node) => node.id).sort()).toEqual(['1', '2', '3', '4', '5', FAN_ID].sort());
            expect(edgeBetweenOperations(graph, 2, 4).label).toBe('[768, 3072]');
        });

        describe('an unrolled fan keeps somewhere to fold from (#2028)', () => {
            const unrolled = () =>
                buildOpGraph(FAN_CHAIN, {
                    hideDeallocate: false,
                    deviceSubgraphs: [],
                    collapseWeightLoads: true,
                    expandedBlockIds: [FAN_ID],
                });

            it('draws a container carrying the fan id, so the fold pill has a node to sit on', () => {
                // The reported bug: unrolling replaced the only node that could fold
                // the fan, leaving the toolbar switch — which resets every fan — as
                // the way back.
                const container = nodeById(unrolled(), FAN_ID);

                expect(container.type).toBe(OpGraphNodeType.WEIGHT_GROUP);
                expect(container.data.blockInstanceId).toBe(FAN_ID);
                expect(container.data.opCount).toBe(3);
            });

            it('parents every member to the container', () => {
                const graph = unrolled();

                for (const memberId of ['1', '2', '3']) {
                    expect(nodeById(graph, memberId).parentId, `member ${memberId}`).toBe(FAN_ID);
                    expect(nodeById(graph, memberId).extent).toBe('parent');
                }
            });

            it('leaves the consumer alone', () => {
                expect(nodeById(unrolled(), '4').parentId).toBeUndefined();
            });

            it('keeps each member edge and its own tensor label', () => {
                // What unrolling is for. Folded, the three collapse to one unlabelled
                // edge; unrolled, each shape is back.
                const graph = unrolled();

                expect(graph.edges.filter((edge) => edge.target === '4')).toHaveLength(3);
                expect(edgeBetweenOperations(graph, 1, 4).label).toBe('[1, 768]');
                expect(edgeBetweenOperations(graph, 2, 4).label).toBe('[768, 3072]');
                expect(edgeBetweenOperations(graph, 3, 4).label).toBe('[1, 3072]');
            });

            it('sizes the container to hold its members', () => {
                const container = nodeById(unrolled(), FAN_ID);

                expect(container.width ?? 0).toBeGreaterThan(0);
                expect(container.height ?? 0).toBeGreaterThan(0);
            });

            it('ranks the container against the consumer, not the members inside it', () => {
                // Dagre only knows top-level nodes, so an edge handed to it naming a
                // child is an edge it drops -- and a dropped edge is a dependency it
                // never ranks. The members keep their own edges for drawing; only the
                // layout copy is rewritten to the container. Left unrewritten the
                // container lands beside its consumer and the two overlap.
                const graph = unrolled();
                const container = nodeById(graph, FAN_ID);
                const consumer = nodeById(graph, '4');

                expect(container.position.y + (container.height ?? 0)).toBeLessThanOrEqual(consumer.position.y);
            });

            it('folds back to the pill when the decision is dropped', () => {
                // The round trip the bug made impossible.
                const refolded = buildOpGraph(FAN_CHAIN, {
                    hideDeallocate: false,
                    deviceSubgraphs: [],
                    collapseWeightLoads: true,
                    expandedBlockIds: [],
                });

                expect(nodeById(refolded, FAN_ID).type).toBe(OpGraphNodeType.BLOCK);
                expect(refolded.nodes.map((node) => node.id)).toEqual([FAN_ID, '4', '5']);
            });
        });

        it('folds a fan the expansion set does not name', () => {
            // Absence means folded for a fan, the opposite of grouping's #1977 default:
            // the switch is on, so an unnamed fan has not been asked for.
            const graph = buildOpGraph(FAN_CHAIN, {
                hideDeallocate: false,
                deviceSubgraphs: [],
                collapseWeightLoads: true,
                expandedBlockIds: [],
            });

            expect(graph.nodes.map((node) => node.id)).toEqual([FAN_ID, '4', '5']);
        });

        it('keeps the fan out of the blocks the toolbar counts', () => {
            // Grouping owns that count; a fan is plumbing, not a detected layer, and
            // Fold / Unroll-all must go on meaning what they meant. #1980
            const graph = buildOpGraph(FAN_CHAIN, {
                hideDeallocate: false,
                deviceSubgraphs: [],
                collapseWeightLoads: true,
            });

            expect(graph.blocks ?? []).toHaveLength(0);
        });

        it('does not collapse loaders that feed different consumers', () => {
            const shared = [
                operation({ id: 1, name: 'ttnn.to_device', outputs: [{ consumers: [3] }] }),
                operation({ id: 2, name: 'ttnn.to_device', outputs: [{ consumers: [3, 4] }] }),
                operation({ id: 3, name: 'ttnn.linear', outputs: [{ consumers: [4] }] }),
                operation({ id: 4, name: 'ttnn.linear' }),
            ];
            const graph = buildOpGraph(shared, {
                hideDeallocate: false,
                deviceSubgraphs: [],
                collapseWeightLoads: true,
            });

            expect(graph.nodes.map((node) => node.id)).toEqual(['1', '2', '3', '4']);
        });
    });

    describe('repeat blocks', () => {
        const REPEAT_CHAIN = [
            operation({ id: 1, name: 'prefix', outputs: [{ consumers: [2] }] }),
            operation({
                id: 2,
                name: 'layer_a',
                outputs: [{ consumers: [3] }],
                durationSeconds: 1.5,
                memoryDeltaBytes: 1024,
            }),
            operation({
                id: 3,
                name: 'layer_b',
                outputs: [{ consumers: [4] }],
                durationSeconds: 0.5,
                memoryDeltaBytes: 256,
            }),
            operation({ id: 4, name: 'layer_a', outputs: [{ consumers: [5] }] }),
            operation({ id: 5, name: 'layer_b', outputs: [{ consumers: [6] }] }),
            operation({ id: 6, name: 'suffix' }),
        ];

        const FIRST_BLOCK_ID = 'block:2';
        const SECOND_BLOCK_ID = 'block:4';

        // Repeats render unrolled unless something folds them, so a test about the
        // collapsed rendering has to ask for the fold: an empty expansion set is
        // "fold every instance", where absent means "nothing folded yet". #1977
        const buildFolded = (operations: OpGraphSourceOperation[], hideDeallocate: boolean) =>
            buildOpGraph(operations, { hideDeallocate, deviceSubgraphs: [], expandedBlockIds: [] });

        const typesOf = (graph: ReturnType<typeof buildOpGraph>) =>
            graph.nodes.map((node) => ({ id: node.id, type: node.type, operationId: node.data.operationId }));

        it('replaces each collapsed copy with a block node and hides the members', () => {
            const graph = buildFolded(REPEAT_CHAIN, false);

            expect(typesOf(graph)).toEqual([
                { id: '1', type: OpGraphNodeType.OP, operationId: 1 },
                { id: FIRST_BLOCK_ID, type: OpGraphNodeType.BLOCK, operationId: 2 },
                { id: SECOND_BLOCK_ID, type: OpGraphNodeType.BLOCK, operationId: 4 },
                { id: '6', type: OpGraphNodeType.OP, operationId: 6 },
            ]);
            expect(graph.blocks?.map((block) => block.instanceId)).toEqual([FIRST_BLOCK_ID, SECOND_BLOCK_ID]);
        });

        it('gives the node and the block summary the same sums', () => {
            // The node's meta line and the panel's stats rows are on screen at the
            // same time; they were derived twice, by independent paths, so drift
            // would have shown as the two disagreeing about one block.
            const graph = buildFolded(REPEAT_CHAIN, false);
            const node = nodeById(graph, FIRST_BLOCK_ID);
            const summary = graph.blocks?.find((block) => block.instanceId === FIRST_BLOCK_ID);

            expect(summary).toBeDefined();
            expect(summary?.durationSeconds).toBe(2);
            expect(summary?.memoryDeltaBytes).toBe(1280);
            expect(node.data.metaLine).toBe(
                formatBlockMeta(
                    summary?.operationIds.length ?? 0,
                    summary?.durationSeconds ?? 0,
                    summary?.memoryDeltaBytes ?? 0,
                ),
            );
        });

        it('sums duration and memory onto the collapsed node', () => {
            const graph = buildFolded(REPEAT_CHAIN, false);
            const first = nodeById(graph, FIRST_BLOCK_ID);

            expect(first.data.opCount).toBe(2);
            // The sums themselves are asserted on the block summary, which is now
            // the single place they are derived; the node carries the formatted line.
            expect(first.data.metaLine).toBe(formatBlockMeta(2, 2, 1280));
            expect(first.data.fileIdentifier).toBe('');
            expect(first.data.memberNames).toEqual(['layer_a', 'layer_b']);
            expect(first.data.memberOperationIds).toEqual([2, 3]);
        });

        it('reroutes crossing edges onto the block and drops edges inside it', () => {
            const graph = buildFolded(REPEAT_CHAIN, false);

            expect(edgeBetweenOperations(graph, 1, 2).source).toBe('1');
            expect(edgeBetweenOperations(graph, 1, 2).target).toBe(FIRST_BLOCK_ID);
            expect(edgeBetweenOperations(graph, 3, 4).source).toBe(FIRST_BLOCK_ID);
            expect(edgeBetweenOperations(graph, 3, 4).target).toBe(SECOND_BLOCK_ID);
            expect(edgeBetweenOperations(graph, 5, 6).source).toBe(SECOND_BLOCK_ID);
            expect(
                graph.edges.find((edge) => edge.data?.sourceOperationId === 2 && edge.data?.targetOperationId === 3),
            ).toBeUndefined();
        });

        it('restores the members when that instance is unrolled', () => {
            const graph = buildOpGraph(REPEAT_CHAIN, {
                hideDeallocate: false,
                deviceSubgraphs: [],
                expandedBlockIds: [FIRST_BLOCK_ID],
            });

            expect(typesOf(graph)).toEqual([
                { id: '1', type: OpGraphNodeType.OP, operationId: 1 },
                { id: '2', type: OpGraphNodeType.OP, operationId: 2 },
                { id: '3', type: OpGraphNodeType.OP, operationId: 3 },
                { id: SECOND_BLOCK_ID, type: OpGraphNodeType.BLOCK, operationId: 4 },
                { id: '6', type: OpGraphNodeType.OP, operationId: 6 },
            ]);
            expect(edgeBetweenOperations(graph, 1, 2).target).toBe('2');
            expect(edgeBetweenOperations(graph, 3, 4).target).toBe(SECOND_BLOCK_ID);
        });

        it('draws one unlabelled edge between a folded pair, regardless of tensor count', () => {
            const twoTensors = [
                operation({
                    id: 1,
                    name: 'layer_a',
                    outputs: [
                        { label: '[1, 32]', consumers: [2, 3] },
                        { label: '[1, 64]', consumers: [3] },
                    ],
                }),
                operation({
                    id: 2,
                    name: 'layer_b',
                    outputs: [{ consumers: [3] }],
                }),
                operation({
                    id: 3,
                    name: 'layer_a',
                    outputs: [
                        { label: '[1, 32]', consumers: [4, 5] },
                        { label: '[1, 64]', consumers: [5] },
                    ],
                }),
                operation({
                    id: 4,
                    name: 'layer_b',
                    outputs: [{ consumers: [5] }],
                }),
                operation({ id: 5, name: 'suffix' }),
            ];
            const graph = buildFolded(twoTensors, false);
            const between = graph.edges.filter((edge) => edge.source === 'block:1' && edge.target === 'block:3');

            expect(between).toHaveLength(1);
            expect(between[0].label).toBeUndefined();
            expect(between[0].data?.parallelIndex).toBe(0);
        });

        it('does not expand device operations for a member still inside a collapsed block', () => {
            const graph = buildOpGraph(REPEAT_CHAIN, {
                hideDeallocate: false,
                deviceSubgraphs: [deviceSubgraph({ operationId: 2 })],
                expandedBlockIds: [],
            });

            expect(graph.nodes.some((node) => node.type === OpGraphNodeType.DEVICE_GROUP)).toBe(false);
            expect(graph.nodes.some((node) => node.type === OpGraphNodeType.DEVICE_OP)).toBe(false);
            expect(nodeById(graph, FIRST_BLOCK_ID).type).toBe(OpGraphNodeType.BLOCK);
        });

        it('detects a repeat that only becomes contiguous once deallocate ops are hidden', () => {
            const withDeallocate = [
                operation({ id: 1, name: 'layer_a', outputs: [{ consumers: [2] }] }),
                operation({ id: 2, name: 'layer_b', outputs: [{ consumers: [3] }] }),
                operation({
                    id: 3,
                    name: 'ttnn.deallocate',
                    outputs: [{ consumers: [4] }],
                }),
                operation({ id: 4, name: 'layer_a', outputs: [{ consumers: [5] }] }),
                operation({ id: 5, name: 'layer_b', outputs: [{ consumers: [6] }] }),
                operation({ id: 6, name: 'suffix' }),
            ];

            expect(
                buildFolded(withDeallocate, false).nodes.filter((node) => node.type === OpGraphNodeType.BLOCK),
            ).toHaveLength(0);

            const hidden = buildFolded(withDeallocate, true);
            expect(hidden.nodes.filter((node) => node.type === OpGraphNodeType.BLOCK)).toHaveLength(2);
            expect(hidden.nodes.some((node) => node.data.filterString === 'ttnn.deallocate')).toBe(false);
        });
    });
});
