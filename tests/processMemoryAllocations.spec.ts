// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { beforeEach, describe, expect, it } from 'vitest';
import { processMemoryAllocations } from '../src/functions/processMemoryAllocations';
import { Node, NodeType } from '../src/model/APIData';
import { StringBufferType } from '../src/model/BufferType';

let nextId = 0;
// Monotonic CB address counter so every cbAllocate() call carries a real numeric
// address — matches the captured-graph wire format (real `circular_buffer_allocate`
// nodes always include `address`) and surfaces any future regression in code that
// assumes a numeric address rather than silently producing NaN. Reset alongside
// `nextId` in `beforeEach`.
let nextCbAddress = 0x1000;
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

function captureStart(): Node {
    return mkNode({
        node_type: NodeType.capture_start,
        params: { name: 'capture', device_id: 0 },
    } as unknown as Partial<Node>);
}

function functionStart(name: string, deviceId: number | undefined = 0): Node {
    return mkNode({
        node_type: NodeType.function_start,
        params: { name, device_id: deviceId },
    } as unknown as Partial<Node>);
}

function functionEnd(name: string): Node {
    return mkNode({
        node_type: NodeType.function_end,
        params: { name },
    } as unknown as Partial<Node>);
}

function cbAllocate(
    coreRangeSet: string,
    size: number,
    address?: number,
    options: { globallyAllocated?: boolean } = {},
): Node {
    // Default to the next slot in our monotonic CB address counter so every node
    // round-trips through `processMemoryAllocations()` with a real numeric address.
    // Bump after read so the next CB starts past this one's end.
    const resolvedAddress = address ?? nextCbAddress;
    nextCbAddress = Math.max(nextCbAddress, resolvedAddress + size);
    return mkNode({
        node_type: NodeType.circular_buffer_allocate,
        params: {
            core_range_set: coreRangeSet,
            size: String(size),
            address: String(resolvedAddress),
            // Matches the on-wire string form emitted by tt-metal.
            globally_allocated: options.globallyAllocated ? '1' : '0',
        },
    } as unknown as Partial<Node>);
}

function cbDeallocateAll(): Node {
    return mkNode({
        node_type: NodeType.circular_buffer_deallocate_all,
        params: {},
    } as unknown as Partial<Node>);
}

function bufferAllocate(type: StringBufferType, size: number, numCores: number): Node {
    return mkNode({
        node_type: NodeType.buffer_allocate,
        params: { type, size: String(size), num_cores: String(numCores) },
    } as unknown as Partial<Node>);
}

function bufferDeallocate(type: StringBufferType, size: number, numCores: number): Node {
    return mkNode({
        node_type: NodeType.buffer_deallocate,
        params: { type, size: String(size), num_cores: String(numCores) },
    } as unknown as Partial<Node>);
}

describe('processMemoryAllocations - CB per-core accounting', () => {
    beforeEach(() => {
        nextId = 0;
        nextCbAddress = 0x1000;
    });

    it('returns zero peak for a graph with no allocations', () => {
        const graph = [captureStart(), functionStart('op'), functionEnd('op')];

        const { peakMemoryLoad, memoryAllocationList } = processMemoryAllocations(graph);

        expect(peakMemoryLoad).toBe(0);
        expect(memoryAllocationList.every((row) => row.total_cb === 0 && row.total_buffer === 0)).toBe(true);
    });

    it('reports total_cb = size for a single CB on a single core', () => {
        const size = 1024 * 1024;
        const graph = [
            captureStart(),
            functionStart('op'),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', size),
            functionEnd('op'),
        ];

        const { peakMemoryLoad, memoryAllocationList } = processMemoryAllocations(graph);

        expect(peakMemoryLoad).toBe(size);
        const cbRow = memoryAllocationList.find((row) => row.type === NodeType.circular_buffer_allocate);
        expect(cbRow?.total_cb).toBe(size);
    });

    it('takes the max-per-core when two CBs live on disjoint cores (issue #1622)', () => {
        const cb1 = 1024 * 1024;
        const cb2 = 750 * 1024;
        const graph = [
            captureStart(),
            functionStart('memory_repro'),
            cbAllocate('{[0-0 - 0-0]}', cb1),
            cbAllocate('{[1-0 - 1-0]}', cb2),
            functionEnd('memory_repro'),
        ];

        const { peakMemoryLoad, memoryAllocationList } = processMemoryAllocations(graph);

        const [, firstCb, secondCb] = memoryAllocationList;
        expect(firstCb.total_cb).toBe(cb1);
        expect(secondCb.total_cb).toBe(cb1);
        expect(peakMemoryLoad).toBe(cb1);
        expect(peakMemoryLoad).toBeLessThan(cb1 + cb2);
    });

    it('sums per-core when two CBs share the same core', () => {
        const cb1 = 1024 * 1024;
        const cb2 = 256 * 1024;
        const graph = [
            captureStart(),
            functionStart('op'),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', cb1),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', cb2),
            functionEnd('op'),
        ];

        const { peakMemoryLoad, memoryAllocationList } = processMemoryAllocations(graph);

        const [, , afterSecond] = memoryAllocationList;
        expect(afterSecond.total_cb).toBe(cb1 + cb2);
        expect(peakMemoryLoad).toBe(cb1 + cb2);
    });

    it('does not double-count overlapping multi-rectangle CB allocations', () => {
        const size = 100;
        const graph = [
            captureStart(),
            functionStart('op'),
            cbAllocate('{[(x=0,y=0) - (x=2,y=2)], [(x=1,y=1) - (x=3,y=3)]}', size),
            functionEnd('op'),
        ];

        const { peakMemoryLoad } = processMemoryAllocations(graph);

        expect(peakMemoryLoad).toBe(size);
    });

    it('clears per-core CB tracking on circular_buffer_deallocate_all', () => {
        const cb1 = 500_000;
        const cb2 = 800_000;
        const graph = [
            captureStart(),
            functionStart('op'),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', cb1),
            cbDeallocateAll(),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', cb2),
            functionEnd('op'),
        ];

        const { peakMemoryLoad, memoryAllocationList } = processMemoryAllocations(graph);

        const dealloc = memoryAllocationList.find((row) => row.type === NodeType.circular_buffer_deallocate_all);
        expect(dealloc?.total_cb).toBe(0);
        expect(peakMemoryLoad).toBe(Math.max(cb1, cb2));
    });

    it('handles modern N-N core_range_set syntax', () => {
        const size = 2048;
        const graph = [captureStart(), functionStart('op'), cbAllocate('{[0-0 - 0-0]}', size), functionEnd('op')];

        const { peakMemoryLoad } = processMemoryAllocations(graph);

        expect(peakMemoryLoad).toBe(size);
    });

    it('keeps unattributed-only CBs out of the per-core peak but still tracks their bytes', () => {
        // CBs with an empty core_range_set land in the "?" bucket - they
        // have no core attribution, so they must not inflate peakMemoryLoad
        // (which is a per-core quantity). The snapshot still surfaces them
        // through unattributedBytes so the UI can flag them.
        const size = 4096;
        const opStart = functionStart('op');
        const graph = [captureStart(), opStart, cbAllocate('{}', size), functionEnd('op')];

        const { peakMemoryLoad, cbPressureByOpId } = processMemoryAllocations(graph);

        expect(peakMemoryLoad).toBe(0);
        const snap = cbPressureByOpId.get(opStart.id);
        expect(snap?.unattributedBytes).toBe(size);
        expect(snap?.maxBytes).toBe(0);
    });

    it('annotates CB allocations with the enclosing function for color variance', () => {
        const graph = [
            captureStart(),
            functionStart('demo_op'),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', 1024),
            functionEnd('demo_op'),
        ];
        const cbNode = graph[2];

        processMemoryAllocations(graph);

        // Cast via `unknown` first — the discriminated-union narrowing on
        // `Node.params` rejects a direct `Record<string, unknown>` cast.
        expect((cbNode.params as unknown as Record<string, unknown>).allocateOperationName).toBe('demo_op');
        expect((cbNode.params as unknown as Record<string, unknown>).allocateOperationId).toBe(graph[1].id);
    });
});

describe('processMemoryAllocations - L1 buffer accounting', () => {
    beforeEach(() => {
        nextId = 0;
        nextCbAddress = 0x1000;
    });

    it('amortizes L1 buffer_allocate over num_cores and reverses on deallocate', () => {
        const size = 64 * 64; // amortizes cleanly across 64 cores
        const graph = [
            captureStart(),
            functionStart('op'),
            bufferAllocate(StringBufferType.L1, size, 64),
            bufferDeallocate(StringBufferType.L1, size, 64),
            functionEnd('op'),
        ];

        const { memoryAllocationList } = processMemoryAllocations(graph);

        const afterAlloc = memoryAllocationList.find((row) => row.type === NodeType.buffer_allocate);
        const afterDealloc = memoryAllocationList.find((row) => row.type === NodeType.buffer_deallocate);
        expect(afterAlloc?.total_buffer).toBe(size / 64);
        expect(afterDealloc?.total_buffer).toBe(0);
    });

    it('ignores DRAM allocations when computing L1 peak', () => {
        const cbSize = 1024;
        const graph = [
            captureStart(),
            functionStart('op'),
            bufferAllocate(StringBufferType.DRAM, 99_999_999, 1),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', cbSize),
            functionEnd('op'),
        ];

        const { peakMemoryLoad } = processMemoryAllocations(graph);

        expect(peakMemoryLoad).toBe(cbSize);
    });
});

describe('processMemoryAllocations - cbPressureByOpId snapshots', () => {
    beforeEach(() => {
        nextId = 0;
        nextCbAddress = 0x1000;
    });

    it('emits no snapshot for ops that never allocate a CB', () => {
        const graph = [captureStart(), functionStart('op'), functionEnd('op')];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        expect(cbPressureByOpId.size).toBe(0);
    });

    it('snapshots on circular_buffer_deallocate_all keyed by the innermost function_start id', () => {
        const cb1 = 1024 * 1024;
        const cb2 = 750 * 1024;
        const opStart = functionStart('memory_repro');
        const graph = [
            captureStart(),
            opStart,
            cbAllocate('{[0-0 - 0-0]}', cb1, 0x1000),
            cbAllocate('{[1-0 - 1-0]}', cb2, 0x2000),
            cbDeallocateAll(),
            functionEnd('memory_repro'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const snap = cbPressureByOpId.get(opStart.id);
        expect(snap).toBeDefined();
        // Disjoint cores: each carries its own CB only - no summation across them.
        expect(snap!.byCore).toEqual({ '0,0': cb1, '1,0': cb2 });
        // Peak is per-core, so it should equal the larger of the two CBs.
        expect(snap!.maxBytes).toBe(cb1);
        expect(snap!.unattributedBytes).toBe(0);
        expect(snap!.allocations).toHaveLength(2);
        expect(snap!.allocations.map((a) => a.size)).toEqual([cb1, cb2]);
        expect(snap!.allocations.map((a) => a.address)).toEqual([0x1000, 0x2000]);
    });

    it('sums sizes for CBs that share a core', () => {
        const cb1 = 1024 * 1024;
        const cb2 = 256 * 1024;
        const opStart = functionStart('op');
        const graph = [
            captureStart(),
            opStart,
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', cb1),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', cb2),
            cbDeallocateAll(),
            functionEnd('op'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const snap = cbPressureByOpId.get(opStart.id)!;
        expect(snap.byCore).toEqual({ '0,0': cb1 + cb2 });
        expect(snap.maxBytes).toBe(cb1 + cb2);
    });

    it('routes empty core_range_set into the "?" bucket and keeps it out of maxBytes', () => {
        const attributed = 1024 * 1024;
        const unattributed = 200 * 1024;
        const opStart = functionStart('op');
        const graph = [
            captureStart(),
            opStart,
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', attributed),
            cbAllocate('{}', unattributed),
            cbDeallocateAll(),
            functionEnd('op'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const snap = cbPressureByOpId.get(opStart.id)!;
        expect(snap.byCore['0,0']).toBe(attributed);
        expect(snap.byCore['?']).toBe(unattributed);
        expect(snap.unattributedBytes).toBe(unattributed);
        // The "?" bucket would dwarf the per-core peak if it leaked in.
        expect(snap.maxBytes).toBe(attributed);
    });

    it('expands a multi-rect CB across every covered core', () => {
        const size = 128;
        const opStart = functionStart('op');
        const graph = [
            captureStart(),
            opStart,
            cbAllocate('{[(x=0,y=0) - (x=2,y=2)]}', size),
            cbDeallocateAll(),
            functionEnd('op'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const snap = cbPressureByOpId.get(opStart.id)!;
        const entries = Object.entries(snap.byCore);
        expect(entries).toHaveLength(9);
        expect(entries.every(([, v]) => v === size)).toBe(true);
        expect(snap.allocations[0].numCores).toBe(9);
        expect(snap.allocations[0].cores).toHaveLength(9);
        expect(snap.maxBytes).toBe(size);
    });

    it('does not double-count overlapping rectangles inside a single CB', () => {
        const size = 100;
        const opStart = functionStart('op');
        const graph = [
            captureStart(),
            opStart,
            cbAllocate('{[(x=0,y=0) - (x=2,y=2)], [(x=1,y=1) - (x=3,y=3)]}', size),
            cbDeallocateAll(),
            functionEnd('op'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const snap = cbPressureByOpId.get(opStart.id)!;
        // Every covered core counts the CB exactly once, even where the
        // rectangles overlap - otherwise byCore would stack 2x size.
        expect(Object.values(snap.byCore).every((v) => v === size)).toBe(true);
        expect(snap.maxBytes).toBe(size);
    });

    it('produces a snapshot at function_end when CBs are still live', () => {
        // Safety net for kernels that never emit circular_buffer_deallocate_all.
        const size = 4096;
        const opStart = functionStart('op');
        const graph = [captureStart(), opStart, cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', size), functionEnd('op')];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const snap = cbPressureByOpId.get(opStart.id);
        expect(snap).toBeDefined();
        expect(snap!.byCore['0,0']).toBe(size);
        expect(snap!.allocations).toHaveLength(1);
    });

    it('prefers the deallocate_all snapshot over the function_end safety net', () => {
        // First CB is captured by dealloc_all; the second batch survives past
        // function_end but the explicit snapshot should not be overwritten.
        const cb1 = 1024;
        const cb2 = 2048;
        const opStart = functionStart('op');
        const graph = [
            captureStart(),
            opStart,
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', cb1),
            cbDeallocateAll(),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', cb2),
            functionEnd('op'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const snap = cbPressureByOpId.get(opStart.id)!;
        expect(snap.allocations).toHaveLength(1);
        expect(snap.allocations[0].size).toBe(cb1);
    });

    it('attributes nested CBs to the innermost open function_start', () => {
        const outerStart = functionStart('outer');
        const innerStart = functionStart('inner');
        const size = 512;
        const graph = [
            captureStart(),
            outerStart,
            innerStart,
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', size),
            cbDeallocateAll(),
            functionEnd('inner'),
            functionEnd('outer'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        expect(cbPressureByOpId.has(innerStart.id)).toBe(true);
        expect(cbPressureByOpId.has(outerStart.id)).toBe(false);
    });

    it('preserves allocation order in the snapshot', () => {
        const opStart = functionStart('op');
        const graph = [
            captureStart(),
            opStart,
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', 100),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', 200),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', 300),
            cbDeallocateAll(),
            functionEnd('op'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const sizes = cbPressureByOpId.get(opStart.id)!.allocations.map((a) => a.size);
        expect(sizes).toEqual([100, 200, 300]);
    });

    it('carries the enclosing op id and name on each allocation summary', () => {
        const opStart = functionStart('demo_op');
        const graph = [
            captureStart(),
            opStart,
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', 1024),
            cbDeallocateAll(),
            functionEnd('demo_op'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const [alloc] = cbPressureByOpId.get(opStart.id)!.allocations;
        expect(alloc.allocateOperationId).toBe(opStart.id);
        expect(alloc.allocateOperationName).toBe('demo_op');
    });

    it('emits an independent snapshot per DeviceOp', () => {
        const op1Start = functionStart('op1');
        const op2Start = functionStart('op2');
        const graph = [
            captureStart(),
            op1Start,
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', 1024),
            cbDeallocateAll(),
            functionEnd('op1'),
            op2Start,
            cbAllocate('{[(x=1,y=1) - (x=1,y=1)]}', 4096),
            cbDeallocateAll(),
            functionEnd('op2'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        expect(cbPressureByOpId.size).toBe(2);
        expect(cbPressureByOpId.get(op1Start.id)!.byCore).toEqual({ '0,0': 1024 });
        expect(cbPressureByOpId.get(op2Start.id)!.byCore).toEqual({ '1,1': 4096 });
    });
});

describe('processMemoryAllocations - globally_allocated CBs (#1651)', () => {
    beforeEach(() => {
        nextId = 0;
        nextCbAddress = 0x1000;
    });

    it('does not advance peakMemoryLoad for a lone globally-allocated CB', () => {
        // Aliased CBs are views into existing L1 sharded buffers, so the
        // bytes are already counted in `total_buffer`. Folding them into the
        // CB pool would double-count and inflate peak.
        const size = 100_000;
        const graph = [
            captureStart(),
            functionStart('halo'),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', size, 0x1000, { globallyAllocated: true }),
            functionEnd('halo'),
        ];

        const { peakMemoryLoad } = processMemoryAllocations(graph);

        expect(peakMemoryLoad).toBe(0);
    });

    it('counts only the anonymous CB toward peak when both are present', () => {
        const aliasedSize = 100_000;
        const anonymousSize = 32;
        const graph = [
            captureStart(),
            functionStart('halo'),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', aliasedSize, 0x1000, { globallyAllocated: true }),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', anonymousSize, 0x2000),
            functionEnd('halo'),
        ];

        const { peakMemoryLoad } = processMemoryAllocations(graph);

        expect(peakMemoryLoad).toBe(anonymousSize);
    });

    it('keeps aliased CBs in the snapshot with the globallyAllocated flag set', () => {
        // The modal needs the row to render it as an outline-only legend
        // entry; only the per-core pressure totals should ignore it.
        const aliasedSize = 100_000;
        const anonymousSize = 32;
        const opStart = functionStart('halo');
        const graph = [
            captureStart(),
            opStart,
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', aliasedSize, 0x1000, { globallyAllocated: true }),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', anonymousSize, 0x2000),
            cbDeallocateAll(),
            functionEnd('halo'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const snap = cbPressureByOpId.get(opStart.id)!;
        expect(snap.allocations).toHaveLength(2);
        const aliased = snap.allocations.find((a) => a.address === 0x1000)!;
        const anonymous = snap.allocations.find((a) => a.address === 0x2000)!;
        expect(aliased.globallyAllocated).toBe(true);
        expect(anonymous.globallyAllocated).toBe(false);
    });

    it('keeps the aliased CB out of byCore but counts the anonymous CB', () => {
        const aliasedSize = 100_000;
        const anonymousSize = 32;
        const opStart = functionStart('halo');
        const graph = [
            captureStart(),
            opStart,
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', aliasedSize, 0x1000, { globallyAllocated: true }),
            cbAllocate('{[(x=0,y=0) - (x=0,y=0)]}', anonymousSize, 0x2000),
            cbDeallocateAll(),
            functionEnd('halo'),
        ];

        const { cbPressureByOpId } = processMemoryAllocations(graph);

        const snap = cbPressureByOpId.get(opStart.id)!;
        expect(snap.byCore).toEqual({ '0,0': anonymousSize });
        expect(snap.maxBytes).toBe(anonymousSize);
    });

    it('treats a missing globally_allocated field as anonymous for back-compat', () => {
        // Older reports captured before the field was added still need to
        // produce the pre-#1651 behaviour - we can't assume the flag is set.
        const size = 1024;
        const opStart = functionStart('op');
        const cbNode = mkNode({
            node_type: NodeType.circular_buffer_allocate,
            params: {
                core_range_set: '{[(x=0,y=0) - (x=0,y=0)]}',
                size: String(size),
                address: String(0x4000),
            },
        } as unknown as Partial<Node>);
        const graph = [captureStart(), opStart, cbNode, cbDeallocateAll(), functionEnd('op')];

        const { peakMemoryLoad, cbPressureByOpId } = processMemoryAllocations(graph);

        expect(peakMemoryLoad).toBe(size);
        const snap = cbPressureByOpId.get(opStart.id)!;
        expect(snap.maxBytes).toBe(size);
        expect(snap.allocations[0].globallyAllocated).toBe(false);
    });
});
