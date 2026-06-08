// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { beforeEach, describe, expect, it } from 'vitest';
import { processMemoryAllocations } from '../src/functions/processMemoryAllocations';
import { Node, NodeType } from '../src/model/APIData';
import { StringBufferType } from '../src/model/BufferType';

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

function cbAllocate(coreRangeSet: string, size: number): Node {
    return mkNode({
        node_type: NodeType.circular_buffer_allocate,
        params: { core_range_set: coreRangeSet, size: String(size) },
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

    it('accounts for size even when core_range_set is empty', () => {
        const size = 4096;
        const graph = [captureStart(), functionStart('op'), cbAllocate('{}', size), functionEnd('op')];

        const { peakMemoryLoad } = processMemoryAllocations(graph);

        expect(peakMemoryLoad).toBe(size);
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

        expect((cbNode.params as Record<string, unknown>).allocateOperationName).toBe('demo_op');
        expect((cbNode.params as Record<string, unknown>).allocateOperationId).toBe(graph[1].id);
    });
});

describe('processMemoryAllocations - L1 buffer accounting', () => {
    beforeEach(() => {
        nextId = 0;
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
