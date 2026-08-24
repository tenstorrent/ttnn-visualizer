// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    buildDeviceOperationSubgraph,
    countDeviceOperations,
} from '../src/components/operation-graph/opGraphDeviceSubgraph';
import { type DeviceOperationNode, type Node, NodeType, type OperationDescription } from '../src/model/APIData';

const OPERATION_ID = 4;

const tensor = (tensorId: number): Node =>
    ({
        id: tensorId,
        node_type: NodeType.tensor,
        params: { tensor_id: tensorId, shape: 'Shape([1, 32])' },
        connections: [],
        inputs: [],
        outputs: [],
        stacking_level: 0,
    }) as unknown as Node;

interface FrameSpec {
    id: number;
    name: string;
    consumes?: number[];
    produces?: number[];
}

// `processInputsOutputs` has already resolved `inputs`/`outputs` by the time the
// derivation sees a frame, so the fixture starts from there rather than from a raw
// `function_start` / `function_end` stream.
const frame = ({ id, name, consumes = [], produces = [] }: FrameSpec): DeviceOperationNode =>
    ({
        id,
        node_type: NodeType.function_start,
        params: { name },
        inputs: consumes.map(tensor),
        outputs: produces.map(tensor),
        input_tensors: consumes,
        connections: [],
        arguments: [],
        stack_trace: [],
        stacking_level: 0,
    }) as unknown as DeviceOperationNode;

const operationWith = (frames: DeviceOperationNode[]): OperationDescription =>
    ({ id: OPERATION_ID, processedConnections: frames }) as unknown as OperationDescription;

const subgraphOf = (frames: DeviceOperationNode[]) => buildDeviceOperationSubgraph(operationWith(frames));

const nodeId = (frameId: number) => `dev:${OPERATION_ID}:${frameId}`;

const endpointsOf = (subgraph: NonNullable<ReturnType<typeof buildDeviceOperationSubgraph>>) =>
    subgraph.edges.map((edge) => [edge.source, edge.target]);

// What `4 ttnn.cumsum` looks like: three device operations bracketed by the
// reshapes that carry the operation's own input and output tensors.
const CUMSUM_FRAMES = [
    frame({ id: 1, name: 'Tensor::reshape', consumes: [20], produces: [22] }),
    frame({ id: 2, name: 'PermuteDeviceOperation', consumes: [22], produces: [24] }),
    frame({ id: 3, name: 'AccumulationDeviceOperation', consumes: [24], produces: [26] }),
    frame({ id: 4, name: 'PermuteDeviceOperation', consumes: [26], produces: [28] }),
    frame({ id: 5, name: 'Tensor::reshape', consumes: [28], produces: [31] }),
];

describe('buildDeviceOperationSubgraph', () => {
    describe('which frames are drawn', () => {
        it('keeps the Tensor:: frames that carry the operation’s own tensors', () => {
            const subgraph = subgraphOf(CUMSUM_FRAMES);

            expect(subgraph?.nodes.map((node) => node.label)).toEqual([
                'Tensor::reshape()',
                'PermuteDeviceOperation()',
                'AccumulationDeviceOperation()',
                'PermuteDeviceOperation()',
                'Tensor::reshape()',
            ]);
        });

        it('drops host, ttnn and unnamed frames', () => {
            const subgraph = subgraphOf([
                frame({ id: 1, name: 'SDPAOperation', produces: [1] }),
                frame({ id: 2, name: 'ttnn.embedding', consumes: [1] }),
                frame({ id: 3, name: 'add(torch)', consumes: [1] }),
                frame({ id: 4, name: 'std::vector', consumes: [1] }),
                frame({ id: 5, name: '', consumes: [1] }),
            ]);

            expect(subgraph?.nodes.map((node) => node.label)).toEqual(['SDPAOperation()']);
        });

        // The badge is drawn from the count and the box from the subgraph, so a
        // count taken through a different predicate would promise a number the
        // expansion then contradicts.
        it('counts exactly what expanding would draw', () => {
            const frames = [
                frame({ id: 1, name: 'Tensor::reshape', produces: [1] }),
                frame({ id: 2, name: 'ttnn.embedding', consumes: [1], produces: [2] }),
                frame({ id: 3, name: 'SDPAOperation', consumes: [2], produces: [3] }),
                frame({ id: 4, name: '', consumes: [3] }),
                frame({ id: 5, name: 'add(torch)', consumes: [3] }),
            ];

            expect(countDeviceOperations(operationWith(frames))).toBe(subgraphOf(frames)?.nodes.length);
            expect(countDeviceOperations(operationWith(frames))).toBe(2);
        });

        it('reports nothing to draw rather than an empty box', () => {
            expect(subgraphOf([])).toBeNull();
            expect(subgraphOf([frame({ id: 1, name: 'ttnn.embedding' })])).toBeNull();
            expect(countDeviceOperations({} as unknown as OperationDescription)).toBe(0);
        });
    });

    describe('node ids', () => {
        // Frame ids and operation ids are both bare numbers from unrelated id
        // spaces, so an unprefixed child would key overlays onto an operation.
        it('namespaces a child so it cannot collide with an operation id', () => {
            const subgraph = subgraphOf([frame({ id: 4, name: 'SDPAOperation', produces: [1] })]);

            expect(subgraph?.nodes[0].id).toBe('dev:4:4');
            expect(subgraph?.nodes[0].id).not.toBe(String(OPERATION_ID));
        });
    });

    describe('edges', () => {
        it('joins a producer to the consumer of its tensor', () => {
            const subgraph = subgraphOf(CUMSUM_FRAMES);

            expect(endpointsOf(subgraph!)).toEqual([
                [nodeId(1), nodeId(2)],
                [nodeId(2), nodeId(3)],
                [nodeId(3), nodeId(4)],
                [nodeId(4), nodeId(5)],
            ]);
        });

        it('names the tensor that flows along it', () => {
            const subgraph = subgraphOf(CUMSUM_FRAMES);

            expect(subgraph?.edges[0].label).toBe('T22 [1, 32]');
        });

        // Two device operations are frequently joined only through frames the graph
        // doesn't draw; dropping those first would sever the link, not shorten it.
        it('reaches through a frame it does not draw', () => {
            const subgraph = subgraphOf([
                frame({ id: 1, name: 'AlphaDeviceOperation', produces: [10] }),
                frame({ id: 2, name: 'ttnn.relay', consumes: [10], produces: [11] }),
                frame({ id: 3, name: 'BetaDeviceOperation', consumes: [11] }),
            ]);

            expect(endpointsOf(subgraph!)).toEqual([[nodeId(1), nodeId(3)]]);
            // The tensor the walk started on, so the label still names something
            // the user can find on the operation.
            expect(subgraph?.edges[0].label).toBe('T10 [1, 32]');
        });

        it('drops a shortcut whose endpoints a longer route already joins', () => {
            const subgraph = subgraphOf([
                frame({ id: 1, name: 'AlphaDeviceOperation', produces: [1, 2] }),
                frame({ id: 2, name: 'BetaDeviceOperation', consumes: [1], produces: [3] }),
                frame({ id: 3, name: 'GammaDeviceOperation', consumes: [2, 3] }),
            ]);

            // Not the triangle: 1 → 3 carries the same dependency as 1 → 2 → 3
            // in less detail.
            expect(endpointsOf(subgraph!)).toEqual([
                [nodeId(1), nodeId(2)],
                [nodeId(2), nodeId(3)],
            ]);
        });
    });

    describe('boundary crossings', () => {
        it('maps a tensor to the device operation that consumes or produces it', () => {
            const subgraph = subgraphOf(CUMSUM_FRAMES);

            expect(subgraph?.entryNodeIdByTensorId[20]).toBe(nodeId(1));
            expect(subgraph?.exitNodeIdByTensorId[31]).toBe(nodeId(5));
        });

        // The operation's own result is usually registered by the enclosing `ttnn.`
        // frame rather than by the device operation that computed it, so the exit
        // lookup misses and the edge would stop at the box.
        it('falls back to the only place an unclaimed tensor could attach', () => {
            const subgraph = subgraphOf(CUMSUM_FRAMES);

            expect(subgraph?.entryFallbackNodeId).toBe(nodeId(1));
            expect(subgraph?.exitFallbackNodeId).toBe(nodeId(5));
        });

        it('offers no fallback when more than one frame could be the end', () => {
            const subgraph = subgraphOf([
                frame({ id: 1, name: 'AlphaDeviceOperation', produces: [1] }),
                frame({ id: 2, name: 'BetaDeviceOperation', consumes: [1], produces: [2] }),
                frame({ id: 3, name: 'GammaDeviceOperation', consumes: [1], produces: [3] }),
            ]);

            expect(subgraph?.entryFallbackNodeId).toBe(nodeId(1));
            // Two sinks: anything but the boundary would invent a connection.
            expect(subgraph?.exitFallbackNodeId).toBeNull();
        });
    });
});
