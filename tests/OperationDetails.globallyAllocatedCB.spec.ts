// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { OperationDetails } from '../src/model/OperationDetails';
import { Node, NodeType, OperationDetailsData } from '../src/model/APIData';
import { PlotDataCustom } from '../src/definitions/PlotConfigurations';

let nextId = 0;
function mkNode<T extends Partial<Node>>(node: T): Node {
    nextId += 1;
    return {
        id: nextId,
        connections: [],
        inputs: [],
        outputs: [],
        stacking_level: 0,
        ...node,
    } as Node;
}

const functionStart = (name: string) =>
    mkNode({
        node_type: NodeType.function_start,
        params: { name, device_id: 0 },
    } as unknown as Partial<Node>);

const functionEnd = (name: string) =>
    mkNode({
        node_type: NodeType.function_end,
        params: { name },
    } as unknown as Partial<Node>);

const cbAllocate = (address: number, size: number, options: { globallyAllocated?: boolean } = {}) =>
    mkNode({
        node_type: NodeType.circular_buffer_allocate,
        params: {
            core_range_set: '{[(x=0,y=0) - (x=0,y=0)]}',
            size: String(size),
            address: String(address),
            globally_allocated: options.globallyAllocated ? '1' : '0',
        },
    } as unknown as Partial<Node>);

const buildOperationDetails = (deviceOperations: Node[]): OperationDetails => {
    nextId = 0;
    const data = {
        id: 1,
        name: 'op',
        inputs: [],
        outputs: [],
        stack_trace: '',
        stack_trace_source_file_id: null,
        operationFileIdentifier: 'op',
        error: null,
        buffers: [],
        buffersSummary: [],
        l1_sizes: [1_000_000],
        device_operations: deviceOperations,
    } as unknown as OperationDetailsData;

    return new OperationDetails(data, [], [], { l1start: 0, l1end: 1_000_000 });
};

describe('OperationDetails circular_buffer_allocate flag plumbing (#1652)', () => {
    it('stamps globallyAllocated onto cbList entries for aliased CBs', () => {
        const op = buildOperationDetails([
            functionStart('matmul'),
            cbAllocate(0x1000, 1024),
            cbAllocate(0x2000, 2048, { globallyAllocated: true }),
            functionEnd('matmul'),
        ]);

        expect(op.deviceOperations).toHaveLength(1);
        const [matmul] = op.deviceOperations;
        expect(matmul.cbList).toHaveLength(2);
        expect(matmul.cbList[0].globallyAllocated).toBe(false);
        expect(matmul.cbList[1].globallyAllocated).toBe(true);
    });

    it('treats a missing globally_allocated param as anonymous for back-compat', () => {
        const cbNodeWithoutFlag = mkNode({
            node_type: NodeType.circular_buffer_allocate,
            params: {
                core_range_set: '{[(x=0,y=0) - (x=0,y=0)]}',
                size: '1024',
                address: '4096',
            },
        } as unknown as Partial<Node>);
        const op = buildOperationDetails([functionStart('matmul'), cbNodeWithoutFlag, functionEnd('matmul')]);

        expect(op.deviceOperations[0].cbList[0].globallyAllocated).toBe(false);
    });
});

describe('OperationDetails.memoryData() CB trace split (#1652)', () => {
    it('emits a separate outlined trace for aliased CBs and excludes them from the condensed CB stripe', () => {
        const op = buildOperationDetails([
            functionStart('matmul'),
            cbAllocate(0x1000, 1024),
            cbAllocate(0x4000, 2048, { globallyAllocated: true }),
            functionEnd('matmul'),
        ]);

        const data = op.memoryData();

        const condensedRange = (data.cbChartData[0] as Partial<PlotDataCustom>)?.memoryData;
        expect(condensedRange?.address).toBe(0x1000);
        expect(condensedRange?.size).toBe(1024);

        const entries = [...data.cbChartDataByOperation.entries()];
        expect(entries).toHaveLength(1);
        const traces = entries[0][1];
        expect(traces).toHaveLength(2);

        const filled = traces[0];
        const outlined = traces[1];
        expect(filled.marker?.color).not.toMatch(/^rgba\(/);
        expect(outlined.marker?.color).toMatch(/^rgba\(\d+,\d+,\d+,0\.5\)$/);
        expect(outlined.marker?.line?.width).toBeGreaterThan(0);
        expect(outlined.hovertemplate).toMatch(/Globally allocated/);
    });

    it('skips the outlined trace entirely when no aliased CBs are present', () => {
        const op = buildOperationDetails([
            functionStart('matmul'),
            cbAllocate(0x1000, 1024),
            cbAllocate(0x2000, 2048),
            functionEnd('matmul'),
        ]);

        const data = op.memoryData();
        const traces = [...data.cbChartDataByOperation.values()][0];
        expect(traces).toHaveLength(2);
        expect(traces.every((trace) => !/^rgba\(/.test(trace.marker?.color as string))).toBe(true);
    });
});
