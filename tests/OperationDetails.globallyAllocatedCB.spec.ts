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

const resolveGloballyAllocatedFlag = (options: { globallyAllocated?: boolean; rawFlag?: string | number }) => {
    if (options.rawFlag !== undefined) {
        return options.rawFlag;
    }
    return options.globallyAllocated ? '1' : '0';
};

const cbAllocate = (
    address: number,
    size: number,
    options: { globallyAllocated?: boolean; rawFlag?: string | number } = {},
) =>
    mkNode({
        node_type: NodeType.circular_buffer_allocate,
        params: {
            core_range_set: '{[(x=0,y=0) - (x=0,y=0)]}',
            size: String(size),
            address: String(address),
            globally_allocated: resolveGloballyAllocatedFlag(options),
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

    it('accepts numeric 1 for globally_allocated (forward-compat with future tt-metal emits)', () => {
        const op = buildOperationDetails([
            functionStart('matmul'),
            cbAllocate(0x2000, 2048, { rawFlag: 1 }),
            functionEnd('matmul'),
        ]);

        expect(op.deviceOperations[0].cbList[0].globallyAllocated).toBe(true);
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

    it('emits only outlined traces when all CBs on a DeviceOp are aliased (Halo case)', () => {
        const op = buildOperationDetails([
            functionStart('halo'),
            cbAllocate(0x1000, 1024, { globallyAllocated: true }),
            cbAllocate(0x2000, 2048, { globallyAllocated: true }),
            functionEnd('halo'),
        ]);

        const data = op.memoryData();
        const traces = [...data.cbChartDataByOperation.values()][0];
        expect(traces).toHaveLength(2);
        expect(traces.every((trace) => /^rgba\(\d+,\d+,\d+,0\.5\)$/.test(trace.marker?.color as string))).toBe(true);
        expect(traces.every((trace) => Number(trace.marker?.line?.width ?? 0) > 0)).toBe(true);

        // Top condensed CB stripe collapses to zero size when the op contributes no fresh CB bytes.
        const condensedRange = (data.cbChartData[0] as Partial<PlotDataCustom>)?.memoryData;
        expect(condensedRange?.size).toBe(0);
    });

    it('handles multi-DeviceOp graphs with mixed aliasing per op (Conv2d case)', () => {
        const op = buildOperationDetails([
            functionStart('halo'),
            cbAllocate(0x1000, 1024, { globallyAllocated: true }),
            functionEnd('halo'),
            functionStart('conv2d'),
            cbAllocate(0x4000, 2048),
            cbAllocate(0x8000, 1024, { globallyAllocated: true }),
            functionEnd('conv2d'),
        ]);

        const entries = [...op.memoryData().cbChartDataByOperation.entries()];
        expect(entries).toHaveLength(2);

        const haloTraces = entries[0][1];
        expect(haloTraces).toHaveLength(1);
        expect(haloTraces[0].marker?.color).toMatch(/^rgba\(\d+,\d+,\d+,0\.5\)$/);

        const convTraces = entries[1][1];
        expect(convTraces).toHaveLength(2);
        expect(convTraces[0].marker?.color).not.toMatch(/^rgba\(/);
        expect(convTraces[1].marker?.color).toMatch(/^rgba\(\d+,\d+,\d+,0\.5\)$/);
    });

    it('cbCondensed range excludes aliased CB addresses above the anonymous envelope', () => {
        const op = buildOperationDetails([
            functionStart('matmul'),
            cbAllocate(0x1000, 1024),
            cbAllocate(0xff000, 2048, { globallyAllocated: true }),
            functionEnd('matmul'),
        ]);

        const data = op.memoryData();
        const top = (data.cbChartData[0] as Partial<PlotDataCustom>).memoryData!;
        expect(top.address).toBe(0x1000);
        expect(top.address + top.size).toBeLessThan(0xff000);
    });
});
