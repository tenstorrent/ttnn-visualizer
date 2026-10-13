// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    getAbortReason,
    getLinkableDeviceOperations,
    getScopePairing,
} from '../src/functions/linkableDeviceOperations';
import { DeviceOperationNodeEnd, Node, NodeType } from '../src/model/APIData';

// `TestFailedDeviceOperations` in `backend/ttnn_visualizer/tests/test_agent_linking.py`
// restates these cases for the agent tools' port. Add a case there too.

const start = (name: string): Node => ({ node_type: NodeType.function_start, params: { name } }) as unknown as Node;

const end = (name: string, aborted?: string | boolean): Node =>
    ({
        node_type: NodeType.function_end,
        params: aborted === undefined ? { name } : { name, aborted },
    }) as unknown as Node;

const both = (nodes: Node[]) => {
    const { starts, ends } = getLinkableDeviceOperations(nodes);

    return { starts: starts.map(({ name }) => name), ends: ends.map(({ name }) => name) };
};

describe('getLinkableDeviceOperations', () => {
    it('names every completed device operation, skipping host-side functions', () => {
        const nodes = [start('ttnn.matmul'), start('Matmul'), end('Matmul'), end('ttnn.matmul')];

        expect(both(nodes)).toEqual({ starts: ['Matmul'], ends: ['Matmul'] });
    });

    it('drops a device operation whose scope ended aborted', () => {
        const nodes = [
            start('ttnn.matmul'),
            start('First'),
            end('First'),
            start('Matmul'),
            end('Matmul', 'true'),
            end('ttnn.matmul', 'true'),
        ];

        expect(both(nodes)).toEqual({ starts: ['First'], ends: ['First'] });
    });

    it('drops a device operation left unclosed, as older captures record a failure', () => {
        const nodes = [start('ttnn.linear'), start('First'), end('First'), start('Matmul')];

        expect(both(nodes)).toEqual({ starts: ['First'], ends: ['First'] });
    });

    it('reads the aborted marker exactly: the string tt-metal writes, or a boolean', () => {
        expect(both([start('Matmul'), end('Matmul', true)])).toEqual({ starts: [], ends: [] });
        expect(both([start('Matmul'), end('Matmul', 'True')])).toEqual({ starts: ['Matmul'], ends: ['Matmul'] });
        expect(both([start('Matmul'), end('Matmul', 'false')])).toEqual({ starts: ['Matmul'], ends: ['Matmul'] });
    });

    it('ignores an end with no open start of its name', () => {
        const nodes = [end('Stray'), start('Matmul'), end('Other'), end('Matmul')];

        expect(both(nodes)).toEqual({ starts: ['Matmul'], ends: ['Matmul'] });
    });

    it('drops the last start of a capture cut off mid-operation, leaving earlier ones', () => {
        expect(both([start('First'), end('First'), start('Second')])).toEqual({ starts: ['First'], ends: ['First'] });
    });

    it('pairs child-first and sequential same-named scopes', () => {
        const nested = [start('Outer'), start('Inner'), end('Inner'), end('Outer')];
        const sequential = [start('Matmul'), start('Matmul'), end('Matmul'), end('Matmul')];

        expect(both(nested)).toEqual({ starts: ['Outer', 'Inner'], ends: ['Inner', 'Outer'] });
        expect(both(sequential)).toEqual({ starts: ['Matmul', 'Matmul'], ends: ['Matmul', 'Matmul'] });
    });

    it('returns nothing for a missing graph', () => {
        expect(getLinkableDeviceOperations(undefined)).toEqual({ starts: [], ends: [] });
    });
});

// Scopes are the frontend's alone: the agent tools link rows to operations, so there is no case to restate.
describe('getLinkableDeviceOperations scopes', () => {
    const scopeNode = (id: number, nodeType: NodeType, name: string): Node =>
        ({ id, node_type: nodeType, params: { name } }) as unknown as Node;

    it('gives each start its own node, and each end the start it closes', () => {
        const nodes = [
            scopeNode(10, NodeType.function_start, 'Outer'),
            scopeNode(11, NodeType.function_start, 'Inner'),
            scopeNode(12, NodeType.function_end, 'Inner'),
            scopeNode(13, NodeType.function_end, 'Outer'),
        ];

        expect(getLinkableDeviceOperations(nodes)).toEqual({
            starts: [
                { name: 'Outer', startNodeId: 10 },
                { name: 'Inner', startNodeId: 11 },
            ],
            ends: [
                { name: 'Inner', startNodeId: 11 },
                { name: 'Outer', startNodeId: 10 },
            ],
        });
    });

    it('tells two runs of the same device operation apart', () => {
        const nodes = [
            scopeNode(20, NodeType.function_start, 'Permute'),
            scopeNode(21, NodeType.function_end, 'Permute'),
            scopeNode(22, NodeType.function_start, 'Accumulation'),
            scopeNode(23, NodeType.function_end, 'Accumulation'),
            scopeNode(24, NodeType.function_start, 'Permute'),
            scopeNode(25, NodeType.function_end, 'Permute'),
        ];
        const { starts, ends } = getLinkableDeviceOperations(nodes);

        expect(starts.map(({ startNodeId }) => startNodeId)).toEqual([20, 22, 24]);
        expect(ends.map(({ startNodeId }) => startNodeId)).toEqual([20, 22, 24]);
    });
});

describe('getScopePairing', () => {
    it('pairs nested and sequential scopes by name', () => {
        const nodes = [
            start('ttnn.matmul'),
            start('First'),
            end('First'),
            start('Matmul'),
            end('Matmul'),
            end('ttnn.matmul'),
        ];

        expect(getScopePairing(nodes)).toEqual({
            startIndexByEndIndex: new Map([
                [2, 1],
                [4, 3],
                [5, 0],
            ]),
            abortedEndIndices: new Set(),
        });
    });

    it('pairs each end of a nested same-named scope with the latest open start', () => {
        const nodes = [start('Tensor::to'), start('Tensor::to'), end('Tensor::to'), end('Tensor::to')];

        expect(getScopePairing(nodes).startIndexByEndIndex).toEqual(
            new Map([
                [2, 1],
                [3, 0],
            ]),
        );
    });

    it('pairs an aborted end with its start, and records it as aborted', () => {
        const pairing = getScopePairing([start('Matmul'), end('Matmul', 'true')]);

        expect(pairing.startIndexByEndIndex).toEqual(new Map([[1, 0]]));
        expect(pairing.abortedEndIndices).toEqual(new Set([1]));
    });

    it('lets an outer end close its own scope past an inner one left unclosed', () => {
        const pairing = getScopePairing([start('ttnn.linear'), start('Matmul'), end('ttnn.linear')]);

        expect(pairing.startIndexByEndIndex).toEqual(new Map([[2, 0]]));
    });

    it('leaves out an end with no open start of its name', () => {
        expect(getScopePairing([end('Stray', 'true'), start('Matmul'), end('Matmul')]).startIndexByEndIndex).toEqual(
            new Map([[2, 1]]),
        );
    });
});

describe('getAbortReason', () => {
    const abortedEnd = (abortReason?: unknown) =>
        ({
            node_type: NodeType.function_end,
            params: { name: 'Matmul', aborted: 'true', abort_reason: abortReason },
        }) as unknown as DeviceOperationNodeEnd;

    it('gives the reason tt-metal recorded', () => {
        expect(getAbortReason(abortedEnd('Out of Memory'))).toBe('Out of Memory');
    });

    it('gives nothing for an empty, blank or missing reason', () => {
        expect(getAbortReason(abortedEnd(''))).toBeNull();
        expect(getAbortReason(abortedEnd('  '))).toBeNull();
        expect(getAbortReason(abortedEnd())).toBeNull();
        expect(getAbortReason(abortedEnd(42))).toBeNull();
    });
});
