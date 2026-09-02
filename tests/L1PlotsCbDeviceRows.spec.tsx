// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { resetPlotPropsCapture } from './mocks/plotComponent';
import L1Plots from '../src/components/operation-details/L1Plots';
import { OperationDetails } from '../src/model/OperationDetails';
import { type Node, NodeType, type OperationDetailsData } from '../src/model/APIData';
import { TestProviders } from './helpers/TestProviders';

// Coverage either side of this seam existed — the pure collapse and the leaf legend
// row — but not the seam itself: that `collapseCbDeviceRows` is called at all, that
// `deviceCount` survives the `as FragmentationEntry` cast, and that it arrives at
// `MemoryLegendElement`. #1879
let nextId = 0;
const mkNode = <T extends Partial<Node>>(node: T): Node => {
    nextId += 1;
    return { id: nextId, connections: [], inputs: [], outputs: [], stacking_level: 0, ...node } as Node;
};

const cbAcrossDevices = (address: number, size: number, devices: number): Node[] =>
    Array.from({ length: devices }, (_, deviceId) =>
        mkNode({
            node_type: NodeType.circular_buffer_allocate,
            params: {
                core_range_set: '{[(x=0,y=0) - (x=0,y=0)]}',
                size: String(size),
                address: String(address),
                globally_allocated: '0',
                device_id: deviceId,
            },
        } as unknown as Partial<Node>),
    );

const buildDetails = (deviceOperations: Node[]): OperationDetails => {
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
        l1_sizes: [1_500_000],
        device_operations: deviceOperations,
    } as unknown as OperationDetailsData;
    return new OperationDetails(data, [], [], { l1start: 0, l1end: 1_500_000 });
};

const MESH_OP = [
    mkNode({
        node_type: NodeType.function_start,
        params: { name: 'matmul', device_id: 0 },
    } as unknown as Partial<Node>),
    ...cbAcrossDevices(0x1b400, 8192, 32),
    mkNode({ node_type: NodeType.function_end, params: { name: 'matmul' } } as unknown as Partial<Node>),
];

const renderPlots = (showCircularBuffer: boolean) => {
    const details = buildDetails(MESH_OP);
    return render(
        <TestProviders>
            <L1Plots
                operationDetails={details}
                previousOperationDetails={details}
                zoomedInViewMainMemory={false}
                plotZoomRangeStart={0}
                plotZoomRangeEnd={1_500_000}
                showCircularBuffer={showCircularBuffer}
                showL1Small={false}
                onBufferClick={vi.fn()}
                onLegendClick={vi.fn()}
            />
        </TestProviders>,
    );
};

const cbLegendRows = (container: HTMLElement) =>
    [...container.querySelectorAll('.legend-item')].filter((row) => /KiB|MiB|B\b/.test(row.textContent ?? ''));

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('L1 plot CB legend rows', () => {
    it('draws one row for a 32-device CB, carrying the device count', () => {
        // Without the collapse this op contributes 32 identical unlabelled rows.
        const view = renderPlots(true);

        const multipliers = [...view.container.querySelectorAll('.legend-multipliers')];
        expect(multipliers).toHaveLength(1);
        expect(multipliers[0].textContent).toBe('x 32 devices');
    });

    it('renders no CB rows at all while the toggle is off', () => {
        const view = renderPlots(false);

        expect(view.container.querySelectorAll('.legend-multipliers')).toHaveLength(0);
    });

    it('keeps the device count out of the right-aligned size cell', () => {
        // The alignment half: the size cell must stay numeric.
        const view = renderPlots(true);

        const sizeCells = [...view.container.querySelectorAll('.format-numbers.monospace.nowrap')];
        expect(sizeCells.some((cell) => /devices/.test(cell.textContent ?? ''))).toBe(false);
        expect(cbLegendRows(view.container).length).toBeGreaterThan(0);
    });
});
