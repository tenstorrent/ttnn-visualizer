// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { resetPlotPropsCapture } from './mocks/plotComponent';
import { OperationDetails } from '../src/model/OperationDetails';
import { BufferData, type Node, NodeType } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { summariseOperationBuffers } from '../src/functions/summariseOperationBuffers';
import { showDeallocationReportAtom } from '../src/store/app';
import { TEST_IDS } from '../src/definitions/TestIds';
import { buildTensorDeallocationReport } from './helpers/lateDeallocationFixtures';
import {
    buildBufferData,
    buildOperationDescription,
    buildOperationDetails,
    buildTensor,
    createNodeFactory,
} from './helpers/operationDetailsFixtures';
import { renderL1Plots } from './helpers/renderL1Plots';

// The legend element is tested with the report handed to it directly, so those
// tests can't see whether `L1Plots` ever passes it down. This pins the seam:
// the switch gates the markers, and each legend branch resolves them. #1862
const LATE_ADDRESS = 0x4000;
const CLEAN_ADDRESS = 0x8000;

const l1Buffer = (address: number, deviceId = 0): BufferData => buildBufferData({ address, device_id: deviceId });

// A globally allocated CB aliases the tensor at its address, so its legend row
// shares that address with the late tensor's row.
const aliasedCbOperation = (address: number): Node[] => {
    const mkNode = createNodeFactory();

    return [
        mkNode({
            node_type: NodeType.function_start,
            params: { name: 'matmul', device_id: 0 },
        } as unknown as Partial<Node>),
        mkNode({
            node_type: NodeType.circular_buffer_allocate,
            params: {
                core_range_set: '{[(x=0,y=0) - (x=0,y=0)]}',
                size: '1024',
                address: String(address),
                globally_allocated: '1',
                device_id: 0,
            },
        } as unknown as Partial<Node>),
        mkNode({ node_type: NodeType.function_end, params: { name: 'matmul' } } as unknown as Partial<Node>),
    ];
};

interface BuildDetailsOptions {
    deviceBuffers?: BufferData[];
    deviceOperations?: Node[];
}

const buildDetails = ({ deviceBuffers = [], deviceOperations = [] }: BuildDetailsOptions = {}): OperationDetails =>
    buildOperationDetails({
        data: {
            buffers: deviceBuffers,
            buffersSummary: [l1Buffer(LATE_ADDRESS), l1Buffer(CLEAN_ADDRESS)],
            device_operations: deviceOperations,
        },
        deallocationReport: [buildTensorDeallocationReport({ address: LATE_ADDRESS })],
    });

interface RenderPlotsOptions {
    showDeallocationReport: boolean;
    showCircularBuffer?: boolean;
    details?: OperationDetails;
}

const renderPlots = ({
    showDeallocationReport,
    showCircularBuffer = false,
    details = buildDetails(),
}: RenderPlotsOptions) =>
    renderL1Plots({
        operationDetails: details,
        showCircularBuffer,
        initialAtomValues: [[showDeallocationReportAtom, showDeallocationReport]],
    });

const markerTestId = (address: number) => `${TEST_IDS.LATE_DEALLOC_LEGEND_MARKER}-${address}`;

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('L1 plot legend late deallocation markers (#1862)', () => {
    it('renders no markers while the switch is off', () => {
        renderPlots({ showDeallocationReport: false });

        expect(screen.queryByTestId(markerTestId(LATE_ADDRESS))).not.toBeInTheDocument();
    });

    it('marks only the reported row while the switch is on', () => {
        renderPlots({ showDeallocationReport: true });

        expect(screen.getAllByTestId(markerTestId(LATE_ADDRESS))).toHaveLength(1);
        expect(screen.queryByTestId(markerTestId(CLEAN_ADDRESS))).not.toBeInTheDocument();
    });

    it('marks a multi-device group once, on its header', () => {
        renderPlots({
            showDeallocationReport: true,
            details: buildDetails({ deviceBuffers: [l1Buffer(LATE_ADDRESS, 0), l1Buffer(LATE_ADDRESS, 1)] }),
        });

        const markers = screen.getAllByTestId(markerTestId(LATE_ADDRESS));
        expect(markers).toHaveLength(1);
        expect(markers[0].closest('.group-header')).not.toBeNull();
    });

    // The plot keeps hatching the tensor while CBs are shown, so its legend row
    // has to keep explaining it — but the CB aliased to the same address must
    // not report the one held tensor a second time.
    it('marks the tensor row and not the aliased CB row while CBs are shown', () => {
        const view = renderPlots({
            showDeallocationReport: true,
            showCircularBuffer: true,
            details: buildDetails({ deviceOperations: aliasedCbOperation(LATE_ADDRESS) }),
        });

        expect(view.container.querySelector('.legend-item.globally-allocated')).not.toBeNull();
        const markers = screen.getAllByTestId(markerTestId(LATE_ADDRESS));
        expect(markers).toHaveLength(1);
        expect(markers[0].closest('.legend-item')).not.toHaveClass('globally-allocated');
    });

    // A larger DRAM buffer at the late tensor's address used to evict it from the
    // summary, leaving the count beside the switch with no hatched row to match. #2078
    it('keeps the late L1 row when a larger DRAM buffer shares its address', () => {
        const l1TensorId = 10;
        const dramTensorId = 20;
        const buffers = [
            buildBufferData({ address: LATE_ADDRESS, buffer_type: BufferType.DRAM, max_size_per_bank: 4096 }),
            l1Buffer(LATE_ADDRESS),
        ];
        const details = buildOperationDetails({
            data: { id: 1, buffers, buffersSummary: summariseOperationBuffers(buffers) },
            operations: [
                buildOperationDescription({
                    id: 1,
                    outputs: [
                        buildTensor({ id: dramTensorId, address: LATE_ADDRESS, buffer_type: BufferType.DRAM }),
                        buildTensor({ id: l1TensorId, address: LATE_ADDRESS, buffer_type: BufferType.L1 }),
                    ],
                }),
            ],
            deallocationReport: [buildTensorDeallocationReport({ address: LATE_ADDRESS })],
        });

        renderPlots({ showDeallocationReport: true, details });

        expect(screen.getAllByTestId(markerTestId(LATE_ADDRESS))).toHaveLength(1);
        expect(screen.getByText(`Tensor ${l1TensorId}`, { exact: false })).toBeInTheDocument();
        expect(screen.queryByText(`Tensor ${dramTensorId}`, { exact: false })).not.toBeInTheDocument();
    });
});
