// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { buildL1PeakDecomposition } from '../src/functions/l1PeakDecomposition';
import { L1PeakPrecision, L1ResidentKind } from '../src/definitions/L1PeakDecomposition';
import { NO_CONSUMER_OPERATION_ID } from '../src/functions/lateDeallocation';
import { Buffer, Node, NodeType } from '../src/model/APIData';
import { BufferType, StringBufferType } from '../src/model/BufferType';

interface NodeOverrides {
    address?: number;
    size?: number;
    maxSizePerBank?: number;
    numCores?: number;
    bufferType?: BufferType;
    deviceId?: number;
    globallyAllocated?: '0' | '1';
}

const TYPE_FOR: Record<number, string> = {
    [BufferType.DRAM]: StringBufferType.DRAM,
    [BufferType.L1]: StringBufferType.L1,
    // tt-metal spells an L1_SMALL node's `type` as 'L1'; only `buffer_type` distinguishes it.
    [BufferType.L1_SMALL]: StringBufferType.L1,
};

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
            type: TYPE_FOR[bufferType],
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

const paramsFor = (operations: { id: number; device_operations: Node[] }[]) => ({
    operations,
    snapshotByOperationId: new Map<number, readonly Buffer[]>(),
    lastUseByAddress: new Map<number, number>(),
});

const build = (
    operations: { id: number; device_operations: Node[] }[],
    snapshot: Record<number, Buffer[]> = {},
    lastUse: Record<number, number> = {},
    bankCount?: number,
) =>
    buildL1PeakDecomposition({
        operations,
        snapshotByOperationId: new Map(Object.entries(snapshot).map(([k, v]) => [Number(k), v])),
        lastUseByAddress: new Map(Object.entries(lastUse).map(([k, v]) => [Number(k), v])),
        bankCount,
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
            [L1ResidentKind.PERSISTENT_TENSOR, 400],
            [L1ResidentKind.CIRCULAR_BUFFER, 250],
        ]);
    });

    it('is exact only for a single resident, because nothing proves two residents share cores', () => {
        const mixed = build([{ id: 1, device_operations: [allocate(1000, 400), cb(10, 250)] }]);
        const twoCbs = build([{ id: 1, device_operations: [cb(10, 250), cb(20, 250)] }]);
        const twoTensors = build([{ id: 1, device_operations: [allocate(1000, 400), allocate(2000, 300)] }]);
        const one = build([{ id: 1, device_operations: [allocate(1000, 400)] }]);

        expect(mixed.peak?.precision).toBe(L1PeakPrecision.UPPER_BOUND);
        expect(twoCbs.peak?.precision).toBe(L1PeakPrecision.UPPER_BOUND);
        expect(twoTensors.peak?.precision).toBe(L1PeakPrecision.UPPER_BOUND);
        expect(one.peak?.precision).toBe(L1PeakPrecision.EXACT);
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

    it('ignores node device_id, because no capture labels allocate and deallocate_all consistently', () => {
        // bge_m3 and sentence_bert allocate CBs on device 0 and clear them on device 1;
        // test_ttnn_moe allocates on 0-31 and clears only on 0. Filtering on any one device
        // means the clear never fires and CBs accumulate for the whole run.
        const result = build([
            {
                id: 1,
                device_operations: [
                    node(NodeType.circular_buffer_allocate, { address: 10, size: 300, deviceId: 0 }),
                    node(NodeType.circular_buffer_deallocate_all, { deviceId: 1 }),
                    node(NodeType.circular_buffer_allocate, { address: 20, size: 300, deviceId: 2 }),
                    node(NodeType.buffer_allocate, { address: 1000, maxSizePerBank: 400, deviceId: 7 }),
                ],
            },
        ]);

        // Honouring device_id would skip the device-1 clear and leave both CBs live: 1000.
        expect(result.peak?.totalBytes).toBe(700);
        expect(result.peak?.circularBufferBytes).toBe(300);
        expect(result.peak?.persistentTensorBytes).toBe(400);
    });

    it('does not carry circular buffers into a later operation', () => {
        // The capture only reports a program's CBs as freed when the NEXT program starts, but a
        // finished program's CBs no longer occupy L1: they never enter the buffer allocator, and
        // tt-metal's own collision check ignores them. Counting the carry inflated resnet50 op 9
        // by 687,808 B -- and put a tensor 67,360 B inside a region it claimed was occupied.
        const result = build([
            { id: 1, device_operations: [cb(10, 500)] },
            { id: 2, device_operations: [allocate(1000, 400)] },
        ]);

        expect(result.byOperationId.get(2)?.circularBufferBytes).toBe(0);
        expect(result.byOperationId.get(2)?.totalBytes).toBe(400);
        expect(result.peak?.totalBytes).toBe(500);
    });

    it('does not treat a no-consumer sentinel as a last use', () => {
        // getLastValidConsumer returns -1 when a tensor's only consumers are deallocate calls.
        const operations = [
            { id: 1, device_operations: [allocate(1000, 400)] },
            { id: 2, device_operations: [allocate(2000, 300)] },
        ];

        const result = build(operations, {}, { 1000: NO_CONSUMER_OPERATION_ID });

        expect(result.byOperationId.get(2)?.staleTensorBytes).toBe(0);
        expect(result.byOperationId.get(2)?.persistentTensorBytes).toBe(700);
    });

    it('measures an operation whose only L1 state arrives through the snapshot', () => {
        // Reconciliation can ADD residents, so an operation running no L1 node of its own can
        // still hold the peak. Measuring only inside the node loop dropped 56% of segformer's ops.
        const result = build([{ id: 1, device_operations: [] }], { 1: [buffer(1000, 900)] });

        expect(result.byOperationId.get(1)?.totalBytes).toBe(900);
        expect(result.peak?.totalBytes).toBe(900);
    });

    it('seeds a snapshot survivor the replay never allocated', () => {
        const result = build([{ id: 1, device_operations: [allocate(1000, 400)] }], {
            1: [buffer(1000, 400), buffer(5000, 250)],
        });

        expect(result.byOperationId.get(1)?.totalBytes).toBe(650);
    });

    it('keeps DRAM and non-L1 buffers out of the reconciled live set', () => {
        const result = build([{ id: 1, device_operations: [allocate(1000, 400)] }], {
            1: [buffer(1000, 400), buffer(9000, 9999, BufferType.DRAM)],
        });

        expect(result.byOperationId.get(1)?.totalBytes).toBe(400);
    });

    it('reports how many allocations each operation boundary reconciled away', () => {
        const result = build(
            [
                {
                    id: 1,
                    device_operations: [allocate(1000, 400), allocate(2000, 300), allocate(4000, 50)],
                },
                { id: 2, device_operations: [allocate(3000, 100)] },
            ],
            { 1: [buffer(1000, 400)], 2: [buffer(1000, 400), buffer(3000, 100)] },
        );

        // Two dropped at op 1's boundary, so a count that assigns rather than accumulates is visible.
        expect(result.byOperationId.get(1)?.reconciledAwayCount).toBe(2);
        expect(result.byOperationId.get(2)?.reconciledAwayCount).toBe(0);
        expect(result.reconciledAwayCount).toBe(2);
    });

    it('re-seeds a snapshot survivor as persistent, never as an intermediate', () => {
        // The graph allocated and freed 1000 inside op 1, so op 1 sees an intermediate; the
        // snapshot then says it survived, and from op 2 it is an ordinary persistent tensor.
        const result = build(
            [
                { id: 1, device_operations: [allocate(1000, 400), free(1000)] },
                { id: 2, device_operations: [allocate(2000, 100)] },
            ],
            { 1: [buffer(1000, 400)] },
        );

        expect(result.byOperationId.get(1)?.intermediateTensorBytes).toBe(400);
        expect(result.byOperationId.get(2)?.intermediateTensorBytes).toBe(0);
        expect(result.byOperationId.get(2)?.persistentTensorBytes).toBe(500);
    });

    it('rejects a null deallocate address rather than reading it as address 0', () => {
        // 276 of segformer's and 288 of visualizer_db's L1 deallocate nodes carry a null
        // address. `Number(null)` is 0 and `null !== undefined`, so a guard that only rejects
        // undefined frees whatever sits at address 0 — and traces_51674 has eight buffers there.
        const nullFree = { ...free(0), params: { ...(free(0) as never as { params: object }).params, address: null } };
        const result = build([
            { id: 1, device_operations: [allocate(0, 400), nullFree as never, allocate(5000, 100)] },
        ]);

        expect(result.byOperationId.get(1)?.totalBytes).toBe(500);
    });

    it('measures the state an operation is entered with, before its first node runs', () => {
        // An operation whose first node is a free was previously measured only after that free,
        // so the residents carried in from the previous snapshot were never its tightest instant.
        const result = build(
            [
                { id: 1, device_operations: [allocate(1000, 400)] },
                { id: 2, device_operations: [free(1000)] },
            ],
            { 1: [buffer(1000, 400)] },
        );

        expect(result.byOperationId.get(2)?.totalBytes).toBe(400);
    });

    it('does not call a reallocation intermediate because an earlier one at that address was freed', () => {
        // allocate(A) free(A) allocate(A) inside one operation leaves the SECOND allocation
        // live; an operation-wide address flag called that survivor intermediate.
        // The second allocation is the larger, so it is the tightest instant and the one the
        // stored decomposition describes.
        const result = build([{ id: 1, device_operations: [allocate(1000, 400), free(1000), allocate(1000, 600)] }]);

        expect(result.byOperationId.get(1)?.persistentTensorBytes).toBe(600);
        expect(result.byOperationId.get(1)?.intermediateTensorBytes).toBe(0);
    });

    it('only calls a buffer intermediate when the same operation allocated it', () => {
        // op 2 frees an address allocated by op 1 and then reuses it. The free does not make
        // the later allocation an intermediate — nothing in op 2 freed *that* allocation.
        const result = build([
            { id: 1, device_operations: [allocate(1000, 400)] },
            { id: 2, device_operations: [free(1000), allocate(1000, 400)] },
        ]);

        expect(result.byOperationId.get(2)?.persistentTensorBytes).toBe(400);
        expect(result.byOperationId.get(2)?.intermediateTensorBytes).toBe(0);
    });

    it('carries the snapshot size forward when the graph disagrees for the same address', () => {
        // Measured: 54 of 258 matched (operation, address) pairs disagree on resnet50_jul28.
        // The allocating operation keeps the graph's figure, since that is what was live during
        // it; every later operation sees the snapshot's.
        const result = build(
            [
                { id: 1, device_operations: [allocate(1000, 160)] },
                { id: 2, device_operations: [allocate(2000, 100)] },
            ],
            { 1: [buffer(1000, 148)] },
        );

        expect(result.byOperationId.get(1)?.totalBytes).toBe(160);
        expect(result.byOperationId.get(2)?.totalBytes).toBe(248);
    });

    it('names each contributor with the operation that last used it', () => {
        const result = build([{ id: 1, device_operations: [allocate(1000, 400), cb(10, 250)] }], {}, { 1000: 5 });
        const tensor = result.peak?.contributors.find((c) => c.address === 1000);
        const buf = result.peak?.contributors.find((c) => c.address === 10);

        expect(tensor?.lastUsedByOperationId).toBe(5);
        expect(buf?.lastUsedByOperationId).toBeNull();
    });

    it('uses the device bank count, not 64, for the per-bank fallback', () => {
        // multihost_poc and test_ttnn_moe run 10x13 grids with l1_num_banks of 120.
        const operations = [
            { id: 1, device_operations: [node(NodeType.buffer_allocate, { address: 1000, size: 12000, numCores: 0 })] },
        ];

        expect(build(operations, {}, {}, 120).peak?.totalBytes).toBe(100);
        expect(build(operations).peak?.totalBytes).toBe(187.5);
    });

    it('flags a peak that exceeds the device L1, and stays quiet when it does not', () => {
        // visualizer_db files a 1,184-operation run under one captured_graph row, gives all 288
        // L1 deallocate nodes a null address and omits max_size_per_bank, so the replay frees
        // nothing and reports 216x a bank. The number is unusable and has to say so.
        const operations = [{ id: 1, device_operations: [allocate(1000, 400), cb(10, 900)] }];

        expect(buildL1PeakDecomposition({ ...paramsFor(operations), capacityBytes: 1000 }).exceedsCapacity).toBe(true);
        expect(buildL1PeakDecomposition({ ...paramsFor(operations), capacityBytes: 5000 }).exceedsCapacity).toBe(false);
        expect(buildL1PeakDecomposition({ ...paramsFor(operations), capacityBytes: 1000 }).capacityBytes).toBe(1000);
    });

    it('cannot judge plausibility without a capacity, and says so rather than guessing', () => {
        const result = build([{ id: 1, device_operations: [allocate(1000, 999999999)] }]);

        expect(result.exceedsCapacity).toBe(false);
        expect(result.capacityBytes).toBeNull();
    });

    it('reports no peak for a run with no L1 activity, but still measures every operation', () => {
        // Every operation gets an entry even at zero, so a series over operation index has no
        // invented gaps — bge_m3 otherwise plots 23 points for a 943-operation run and a reader
        // cannot tell "measured as empty" from "not measured".
        const result = build([
            { id: 1, device_operations: [allocate(1000, 400, BufferType.DRAM)] },
            { id: 2, device_operations: [] },
        ]);

        expect(result.peak).toBeNull();
        expect(result.byOperationId.size).toBe(2);
        expect(result.byOperationId.get(1)?.totalBytes).toBe(0);
    });

    it('names the first operation to reach the peak when several tie', () => {
        // Ties are the norm: resnet50_aug06 reaches its peak at both 146 and 257, segformer at
        // both 219 and 283. Which one the headline names must not depend on iteration order.
        const result = build([
            { id: 1, device_operations: [allocate(1000, 400), free(1000)] },
            { id: 2, device_operations: [allocate(2000, 400), free(2000)] },
        ]);

        expect(result.peak?.totalBytes).toBe(400);
        expect(result.peak?.operationId).toBe(1);
    });

    it('refuses only above the budget, not at it', () => {
        const operations = [{ id: 1, device_operations: [allocate(1000, 400)] }];

        expect(buildL1PeakDecomposition({ ...paramsFor(operations), capacityBytes: 400 }).exceedsCapacity).toBe(false);
        expect(buildL1PeakDecomposition({ ...paramsFor(operations), capacityBytes: 399 }).exceedsCapacity).toBe(true);
    });

    it('counts L1_SMALL in the snapshot it reconciles against, not only in the replay', () => {
        // Dropping L1_SMALL from the snapshot filter moves resnet50's peak by 1,680 B and its
        // reconciled count from 32 to 98, because every L1_SMALL allocation is then dropped at
        // each boundary as though the snapshot had freed it.
        const result = build(
            [
                { id: 1, device_operations: [allocate(1000, 400), allocate(2000, 64, BufferType.L1_SMALL)] },
                { id: 2, device_operations: [allocate(3000, 100)] },
            ],
            { 1: [buffer(1000, 400), buffer(2000, 64, BufferType.L1_SMALL)] },
        );

        expect(result.byOperationId.get(1)?.reconciledAwayCount).toBe(0);
        expect(result.byOperationId.get(2)?.totalBytes).toBe(564);
    });
});
