// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    getFailedDeviceOperationNames,
    getLinkableDeviceOperationNames,
} from '../src/functions/linkableDeviceOperations';
import { Node, NodeType } from '../src/model/APIData';

// `TestFailedDeviceOperations` in `backend/ttnn_visualizer/tests/test_agent_linking.py`
// restates these cases for the agent tools' port. Add a case there too.

const start = (name: string): Node => ({ node_type: NodeType.function_start, params: { name } }) as unknown as Node;

const end = (name: string, aborted?: string | boolean): Node =>
    ({
        node_type: NodeType.function_end,
        params: aborted === undefined ? { name } : { name, aborted },
    }) as unknown as Node;

const both = (nodes: Node[]) => ({
    starts: getLinkableDeviceOperationNames(nodes, NodeType.function_start),
    ends: getLinkableDeviceOperationNames(nodes, NodeType.function_end),
});

describe('getLinkableDeviceOperationNames', () => {
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

    it('reads a boolean aborted marker as aborted', () => {
        expect(both([start('Matmul'), end('Matmul', true)])).toEqual({ starts: [], ends: [] });
    });

    it('pairs child-first and sequential same-named scopes', () => {
        const nested = [start('Outer'), start('Inner'), end('Inner'), end('Outer')];
        const sequential = [start('Matmul'), start('Matmul'), end('Matmul'), end('Matmul')];

        expect(both(nested)).toEqual({ starts: ['Outer', 'Inner'], ends: ['Inner', 'Outer'] });
        expect(both(sequential)).toEqual({ starts: ['Matmul', 'Matmul'], ends: ['Matmul', 'Matmul'] });
    });

    it('returns nothing for a missing graph', () => {
        expect(getLinkableDeviceOperationNames(undefined, NodeType.function_start)).toEqual([]);
    });
});

describe('getFailedDeviceOperationNames', () => {
    it('names the device operation whose launch did not complete, in either capture shape', () => {
        const aborted = [start('ttnn.conv2d'), start('Halo'), end('Halo'), start('Conv2d'), end('Conv2d', 'true')];
        const unclosed = [start('ttnn.conv2d'), start('Halo'), end('Halo'), start('Conv2d')];

        expect(getFailedDeviceOperationNames(aborted)).toEqual(['Conv2d']);
        expect(getFailedDeviceOperationNames(unclosed)).toEqual(['Conv2d']);
        expect(getFailedDeviceOperationNames([start('Halo'), end('Halo')])).toEqual([]);
    });
});
