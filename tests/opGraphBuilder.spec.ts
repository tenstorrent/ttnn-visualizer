// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { buildOpGraph } from '../src/components/operation-graph/opGraphBuilder';
import type { OpGraphSourceOperation } from '../src/components/operation-graph/opGraphTypes';

interface OperationSpec {
    id: number;
    name?: string;
    outputs?: { label?: string; consumers: number[] }[];
}

const operation = ({ id, name = `ttnn.op${id}`, outputs = [] }: OperationSpec): OpGraphSourceOperation => ({
    id,
    name,
    fileIdentifier: `model.py:${id}`,
    outputs: outputs.map(({ label = '[1, 32]', consumers }) => ({ edgeLabel: label, consumers })),
});

const build = (operations: OpGraphSourceOperation[], hideDeallocate: boolean) =>
    buildOpGraph(operations, { hideDeallocate });

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
});
