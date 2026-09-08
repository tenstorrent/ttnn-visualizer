// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeviceOperationsFullRender from '../src/components/operation-details/DeviceOperationsFullRender';
import { Node, NodeType } from '../src/model/APIData';
import { OperationDetails } from '../src/model/OperationDetails';
import { TestProviders } from './helpers/TestProviders';

// The always-mounted `CircularBufferPressureModal` is the subtree's only API caller.
const mockUseDevices = vi.fn();
vi.mock('../src/hooks/useAPI.tsx', () => ({
    useDevices: () => mockUseDevices(),
}));

// Unsorted, as a real capture emits them, so nothing here can lean on ascending
// order. The sequence recorded in #1844.
const MESH_DEVICE_IDS = [6, 4, 5, 7, 3, 2, 0, 1];
const CORE_RANGE = '{[(x=0,y=0) - (x=1,y=0)]}';

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
    return mkNode({ node_type: NodeType.capture_start, params: { name: 'capture' } } as unknown as Partial<Node>);
}

function functionStart(name: string): Node {
    return mkNode({ node_type: NodeType.function_start, params: { name } } as unknown as Partial<Node>);
}

function functionEnd(name: string): Node {
    return mkNode({ node_type: NodeType.function_end, params: { name } } as unknown as Partial<Node>);
}

function cbAllocate(size: number, address: number, deviceId?: number): Node {
    return mkNode({
        node_type: NodeType.circular_buffer_allocate,
        params: {
            core_range_set: CORE_RANGE,
            size: String(size),
            address: String(address),
            num_cores: '2',
            globally_allocated: '0',
            ...(deviceId !== undefined && { device_id: deviceId }),
        },
    } as unknown as Partial<Node>);
}

function cbDeallocateAll(): Node {
    return mkNode({ node_type: NodeType.circular_buffer_deallocate_all, params: {} } as unknown as Partial<Node>);
}

function meshGraph(sizes: { size: number; address: number }[], deviceIds: (number | undefined)[]): Node[] {
    const cbs = sizes.flatMap(({ size, address }) => deviceIds.map((id) => cbAllocate(size, address, id)));
    return [captureStart(), functionStart('MeshOp'), ...cbs, cbDeallocateAll(), functionEnd('MeshOp')];
}

const details = {
    l1_sizes: [1_000_000],
    getTensorForAddress: () => undefined,
    getTensorProducerConsumer: () => [],
} as unknown as OperationDetails;

function renderGraph(graph: Node[]) {
    const { container } = render(
        <TestProviders>
            <DeviceOperationsFullRender
                deviceOperations={graph}
                details={details}
                onLegendClick={vi.fn()}
            />
        </TestProviders>,
    );
    return container;
}

const legendRows = (container: HTMLElement) => container.querySelectorAll('.memory-legend-row');
const peakLoad = (container: HTMLElement) => container.querySelector('.peak-load .format-numbers')?.textContent;

beforeEach(() => {
    nextId = 0;
    mockUseDevices.mockReturnValue({ data: [{ num_x_cores: 2, num_y_cores: 2, worker_l1_size: 1_000_000 }] });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('DeviceOperationsFullRender - per-device CB fan-out (#1844)', () => {
    const TWO_CBS = [
        { size: 4096, address: 0x1000 },
        //
        { size: 2048, address: 0x2000 },
    ];

    it('renders one row per logical CB rather than one per device', () => {
        const container = renderGraph(meshGraph(TWO_CBS, MESH_DEVICE_IDS));

        // 2 CBs x 8 devices = 16 allocate nodes in the graph.
        expect(legendRows(container)).toHaveLength(2);
    });

    it('labels each collapsed row with the number of devices behind it', () => {
        const container = renderGraph(meshGraph(TWO_CBS, MESH_DEVICE_IDS));

        const labels = [...legendRows(container)].map((row) => row.textContent);
        expect(labels.every((text) => text?.includes('x 8 devices'))).toBe(true);
    });

    it('emits the CBs heading once even though later devices are skipped', () => {
        const container = renderGraph(meshGraph(TWO_CBS, MESH_DEVICE_IDS));

        // Skipping a row must not clear the heading latch, or each skipped
        // device opens a fresh "CBs" section.
        expect(container.querySelectorAll('.cbs-heading')).toHaveLength(1);
    });

    it('reports the same peak L1 load as the equivalent single-device graph', () => {
        const mesh = renderGraph(meshGraph(TWO_CBS, MESH_DEVICE_IDS));
        const meshPeak = peakLoad(mesh);
        cleanup();

        nextId = 0;
        const single = renderGraph(meshGraph(TWO_CBS, [0]));

        expect(meshPeak).toBe(peakLoad(single));
        // Guards against both readings being an empty/absent heading.
        expect(meshPeak).toMatch(/\d/);
    });

    it('keeps a repeat allocation on the same device as its own row', () => {
        const container = renderGraph(meshGraph([{ size: 4096, address: 0x1000 }], [0, 0]));

        expect(legendRows(container)).toHaveLength(2);
        expect([...legendRows(container)].some((row) => row.textContent?.includes('devices'))).toBe(false);
    });

    it('renders one row per CB and no device label when the graph carries no device_id', () => {
        const container = renderGraph(meshGraph(TWO_CBS, [undefined]));

        expect(legendRows(container)).toHaveLength(2);
        expect([...legendRows(container)].some((row) => row.textContent?.includes('devices'))).toBe(false);
    });

    // The snapshot reaches the modal only through this button, so without
    // opening it nothing would catch the wrong DeviceOp being wired up.
    // The dialog renders through a portal, so its rows are not under `container`.
    const openPressureModal = () => {
        fireEvent.click(screen.getByRole('button', { name: /View per-core allocations/ }));
        return document.querySelectorAll('.cb-row');
    };

    it('carries the collapsed device counts through to the pressure modal', () => {
        renderGraph(meshGraph(TWO_CBS, MESH_DEVICE_IDS));

        const rows = openPressureModal();
        expect(rows).toHaveLength(2);
        expect([...rows].every((row) => /x 8 devices/.test(row.textContent ?? ''))).toBe(true);
    });

    it('counts devices per CB in the modal rather than applying one count to all', () => {
        // dev0 allocates both CBs, dev1 only the first, so a blanket count would
        // pass a homogeneous fixture but not this one.
        const shared = { size: 4096, address: 0x1000 };
        const dev0Only = { size: 2048, address: 0x2000 };
        const graph = [
            captureStart(),
            functionStart('MeshOp'),
            cbAllocate(shared.size, shared.address, 0),
            cbAllocate(dev0Only.size, dev0Only.address, 0),
            cbAllocate(shared.size, shared.address, 1),
            cbDeallocateAll(),
            functionEnd('MeshOp'),
        ];
        renderGraph(graph);

        const rows = [...openPressureModal()].map((row) => row.textContent ?? '');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatch(/x 2 devices/);
        expect(rows[1]).not.toMatch(/devices/);
    });
});
