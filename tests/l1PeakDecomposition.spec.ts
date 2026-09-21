// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { L1PeakPrecision, L1ResidentKind, buildL1PeakDecomposition } from '../src/functions/l1PeakDecomposition';
import { Buffer, Node, NodeType } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';

interface NodeOverrides {
    address?: number;
    size?: number;
    maxSizePerBank?: number;
    numCores?: number;
    bufferType?: BufferType;
    deviceId?: number;
    globallyAllocated?: '0' | '1';
}

const node = (nodeType: NodeType, overrides: NodeOverrides = {}): Node => {
    const {
        address = 0,
        size = 0,
        maxSizePerBank,
        numCores = 64,
        bufferType = BufferType.L1,
        deviceId = 0,
        globallyAllocated,
    } = overrides;

    return {
        node_type: nodeType,
        id: 0,
        connections: [],
        inputs: [],
        outputs: [],
        stacking_level: 1,
        params: {
            address: String(address),
            size: String(size),
            num_cores: String(numCores),
            buffer_type: bufferType,
            device_id: deviceId,
            ...(maxSizePerBank === undefined ? {} : { max_size_per_bank: String(maxSizePerBank) }),
            ...(globallyAllocated === undefined ? {} : { globally_allocated: globallyAllocated }),
        },
    } as unknown as Node;
};

const allocate = (address: number, maxSizePerBank: number, bufferType = BufferType.L1) =>
    node(NodeType.buffer_allocate, { address, maxSizePerBank, bufferType });

const free = (address: number, bufferType = BufferType.L1) => node(NodeType.buffer_deallocate, { address, bufferType });

const cb = (address: number, size: number, globallyAllocated?: '0' | '1') =>
    node(NodeType.circular_buffer_allocate, { address, size, globallyAllocated });

const freeAllCbs = () => node(NodeType.circular_buffer_deallocate_all);

const buffer = (address: number, size: number, bufferType = BufferType.L1, deviceId = 0): Buffer => ({
    address,
    size,
    buffer_type: bufferType,
    device_id: deviceId,
});

const build = (
    operations: { id: number; device_operations: Node[] }[],
    snapshot: Record<number, Buffer[]> = {},
    lastUse: Record<number, number> = {},
    deviceId: number | null = null,
) =>
    buildL1PeakDecomposition({
        operations,
        snapshotByOperationId: new Map(Object.entries(snapshot).map(([k, v]) => [Number(k), v])),
        lastUseByAddress: new Map(Object.entries(lastUse).map(([k, v]) => [Number(k), v])),
        deviceId,
    });

describe('buildL1PeakDecomposition', () => {
    it('reports the tightest instant in an operation, not its final state', () => {
        const result = build([
            { id: 1, device_operations: [allocate(1000, 400), allocate(2000, 600), free(2000), free(1000)] },
        ]);

        expect(result.peak?.totalBytes).toBe(1000);
        expect(result.peak?.operationId).toBe(1);
    });

    it('adds circular buffers to tensor occupancy', () => {
        const result = build([{ id: 1, device_operations: [allocate(1000, 400), cb(10, 250)] }]);

        expect(result.peak?.circularBufferBytes).toBe(250);
        expect(result.peak?.persistentTensorBytes).toBe(400);
        expect(result.peak?.totalBytes).toBe(650);
    });

    it('excludes a globally_allocated circular buffer as a view of a tensor already counted', () => {
        const withView = build([{ id: 1, device_operations: [allocate(1000, 400), cb(1000, 400, '1')] }]);
        const withReal = build([{ id: 1, device_operations: [allocate(1000, 400), cb(1000, 400, '0')] }]);

        expect(withView.peak?.totalBytes).toBe(400);
        expect(withView.peak?.circularBufferBytes).toBe(0);
        expect(withReal.peak?.totalBytes).toBe(800);
    });

    it('releases circular buffers on deallocate_all, so later ones do not stack on them', () => {
        // The peak has to land *after* the clear, or the clear is never exercised:
        // without it the two 500-byte CBs would both be resident, giving 1100.
        const result = build([
            { id: 1, device_operations: [cb(10, 500), freeAllCbs(), cb(20, 500), allocate(1000, 100)] },
        ]);

        expect(result.peak?.totalBytes).toBe(600);
    });

    it('keeps tensors across deallocate_all, which frees only circular buffers', () => {
        // Peak lands after the clear and includes the tensor allocated before it;
        // clearing tensors too would give 300.
        const result = build([
            { id: 1, device_operations: [allocate(1000, 400), cb(10, 100), freeAllCbs(), cb(20, 300)] },
        ]);

        expect(result.peak?.totalBytes).toBe(700);
    });

    it('carries tensors across operations, unlike circular buffers', () => {
        const result = build([
            { id: 1, device_operations: [allocate(1000, 400)] },
            { id: 2, device_operations: [allocate(2000, 300)] },
        ]);

        expect(result.byOperationId.get(2)?.totalBytes).toBe(700);
    });

    it('drops allocations the graph never freed, using the snapshot as ground truth', () => {
        const operations = [
            { id: 1, device_operations: [allocate(1000, 400)] },
            { id: 2, device_operations: [allocate(2000, 300)] },
        ];

        const leaked = build(operations);
        const reconciled = build(operations, { 1: [], 2: [buffer(2000, 300)] });

        expect(leaked.byOperationId.get(2)?.totalBytes).toBe(700);
        expect(reconciled.byOperationId.get(2)?.totalBytes).toBe(300);
        expect(reconciled.reconciledAwayCount).toBe(1);
    });

    it('treats an operation missing from the snapshot as uncaptured rather than empty', () => {
        const operations = [
            { id: 1, device_operations: [allocate(1000, 400)] },
            { id: 2, device_operations: [allocate(2000, 300)] },
        ];

        const result = build(operations, { 1: [buffer(1000, 400)] });

        expect(result.byOperationId.get(2)?.totalBytes).toBe(700);
        expect(result.reconciledAwayCount).toBe(0);
    });

    it('classifies a buffer freed by its own operation as intermediate', () => {
        const result = build([{ id: 1, device_operations: [allocate(1000, 400), free(1000)] }]);

        expect(result.peak?.intermediateTensorBytes).toBe(400);
        expect(result.peak?.persistentTensorBytes).toBe(0);
    });

    it('classifies a buffer still live past its last consumer as stale', () => {
        const operations = [
            { id: 1, device_operations: [allocate(1000, 400)] },
            { id: 2, device_operations: [allocate(2000, 300)] },
        ];

        const result = build(operations, {}, { 1000: 1 });

        expect(result.byOperationId.get(2)?.staleTensorBytes).toBe(400);
        expect(result.byOperationId.get(2)?.persistentTensorBytes).toBe(300);
        expect(result.byOperationId.get(1)?.staleTensorBytes).toBe(0);
    });

    it('names the contributors at the peak, largest first', () => {
        const result = build([{ id: 1, device_operations: [allocate(1000, 400), cb(10, 250)] }]);

        expect(result.peak?.contributors.map((c) => [c.kind, c.bytes])).toEqual([
            [L1ResidentKind.PersistentTensor, 400],
            [L1ResidentKind.CircularBuffer, 250],
        ]);
    });

    it('marks a mixed peak as an upper bound and a single-class peak as exact', () => {
        const mixed = build([{ id: 1, device_operations: [allocate(1000, 400), cb(10, 250)] }]);
        const cbsOnly = build([{ id: 1, device_operations: [cb(10, 250)] }]);
        const tensorsOnly = build([{ id: 1, device_operations: [allocate(1000, 400)] }]);

        expect(mixed.peak?.precision).toBe(L1PeakPrecision.UpperBound);
        expect(cbsOnly.peak?.precision).toBe(L1PeakPrecision.Exact);
        expect(tensorsOnly.peak?.precision).toBe(L1PeakPrecision.Exact);
    });

    it('counts L1_SMALL against L1 and ignores DRAM', () => {
        const result = build([
            {
                id: 1,
                device_operations: [allocate(1000, 400, BufferType.L1_SMALL), allocate(2000, 999, BufferType.DRAM)],
            },
        ]);

        expect(result.peak?.totalBytes).toBe(400);
    });

    it('derives per-bank bytes from size when max_size_per_bank is absent, and survives num_cores of zero', () => {
        const derived = build([
            { id: 1, device_operations: [node(NodeType.buffer_allocate, { address: 1000, size: 6400, numCores: 32 })] },
        ]);
        const zeroCores = build([
            { id: 1, device_operations: [node(NodeType.buffer_allocate, { address: 1000, size: 6400, numCores: 0 })] },
        ]);

        expect(derived.peak?.totalBytes).toBe(200);
        expect(zeroCores.peak?.totalBytes).toBe(100);
    });

    it('tolerates nodes with null params', () => {
        const captureStart = { ...node(NodeType.capture_start), params: null } as unknown as Node;
        const result = build([{ id: 1, device_operations: [captureStart, allocate(1000, 400)] }]);

        expect(result.peak?.totalBytes).toBe(400);
    });

    it('accounts for one device when asked, and every device when not', () => {
        const operations = [
            {
                id: 1,
                device_operations: [
                    node(NodeType.buffer_allocate, { address: 1000, maxSizePerBank: 400, deviceId: 0 }),
                    node(NodeType.buffer_allocate, { address: 2000, maxSizePerBank: 300, deviceId: 1 }),
                ],
            },
        ];

        expect(build(operations, {}, {}, 0).peak?.totalBytes).toBe(400);
        expect(build(operations, {}, {}, 1).peak?.totalBytes).toBe(300);
        expect(build(operations, {}, {}, null).peak?.totalBytes).toBe(700);
    });

    it('reports no peak for a run with no L1 activity', () => {
        const result = build([{ id: 1, device_operations: [allocate(1000, 400, BufferType.DRAM)] }]);

        expect(result.peak).toBeNull();
        expect(result.byOperationId.size).toBe(0);
    });
});
