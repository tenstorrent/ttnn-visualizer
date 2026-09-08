// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BufferSummaryPlotRenderer from '../src/components/buffer-summary/BufferSummaryPlotRenderer';
import { BufferType } from '../src/model/BufferType';
import { LateDeallocationRunStart } from '../src/definitions/LateDeallocation';
import { TensorDeallocationReport } from '../src/model/BufferSummary';
import { UseLateDeallocationOverlayResult } from '../src/hooks/useLateDeallocationOverlay';
import { TestProviders } from './helpers/TestProviders';
import { buildLateDeallocationRunStart, buildTensorDeallocationReport } from './helpers/lateDeallocationFixtures';

const virtualizedListMock = vi.fn();
const lateDeallocationOverlayMock = vi.fn();

vi.mock('../src/components/buffer-summary/BufferSummaryVirtualizedList', () => ({
    default: (props: unknown) => {
        virtualizedListMock(props);
        return <div data-testid='buffer-summary-virtualized-list' />;
    },
}));

vi.mock('../src/hooks/useLateDeallocationOverlay', () => ({
    useLateDeallocationOverlay: (params: unknown) => lateDeallocationOverlayMock(params),
}));

vi.mock('../src/hooks/useTopNAnnotations', () => ({
    useTopNAnnotations: () => ({ annotationsByOpId: new Map() }),
}));

vi.mock('../src/hooks/useAPI', () => ({
    useDevices: () => ({ data: [{ worker_l1_size: 2048 }], isLoading: false }),
    useOperationsList: () => ({
        data: [{ id: 1, name: 'op-1', operationFileIdentifier: 'op-1-file' }],
    }),
    useGetL1StartMarker: () => 0,
    useGetL1SmallMarker: () => 1024,
}));

const operations = [
    {
        id: 1,
        name: 'op-1',
        buffers: [{ address: 100, size: 16, device_id: 0, buffer_type: BufferType.L1 }],
    },
    {
        id: 2,
        name: 'op-2',
        buffers: [{ address: 200, size: 32, device_id: 0, buffer_type: BufferType.L1 }],
    },
];

const tensorListByOperation = new Map<number, Map<number, never>>();

const EMPTY_REPORT: TensorDeallocationReport[] = [];

function buildOverlayResult(overrides: Partial<UseLateDeallocationOverlayResult> = {}) {
    return {
        getTensorDeallocationReport: () => EMPTY_REPORT,
        runStarts: [] as readonly LateDeallocationRunStart[],
        runStartCount: 0,
        ...overrides,
    };
}

function renderRenderer() {
    return render(
        <TestProviders>
            <BufferSummaryPlotRenderer
                uniqueBuffersByOperationList={operations}
                tensorListByOperation={tensorListByOperation}
            />
        </TestProviders>,
    );
}

const getListProps = () => virtualizedListMock.mock.calls[0][0];

beforeEach(() => {
    vi.clearAllMocks();
    lateDeallocationOverlayMock.mockReturnValue(buildOverlayResult());
});

afterEach(cleanup);

// This is the only place the overlay hook meets the list, and both halves are
// otherwise tested in isolation — so a prop swapped for its neighbour or dropped
// entirely leaves the count reading zero, the toggle permanently disabled, and
// every other spec in the suite still green.
describe('BufferSummaryPlotRenderer late deallocation wiring (#963)', () => {
    it('hands the rendered rows to the overlay, so run-start rows index what the user sees', () => {
        renderRenderer();

        expect(lateDeallocationOverlayMock).toHaveBeenCalledWith({ operations });
    });

    it('forwards the run starts, the count and the per-row report to the list', () => {
        const runStarts = [buildLateDeallocationRunStart({ opId: 2, rowIndex: 1 })];
        const report = [buildTensorDeallocationReport({ id: 7 })];
        lateDeallocationOverlayMock.mockReturnValue(
            buildOverlayResult({
                getTensorDeallocationReport: () => report,
                runStarts,
                runStartCount: 4,
            }),
        );

        renderRenderer();

        const props = getListProps();
        expect(props.lateDeallocationRunStarts).toBe(runStarts);
        expect(props.lateDeallocationRunCount).toBe(4);
        expect(props.getTensorDeallocationReport(1)).toBe(report);
    });

    // The count is what tells the user the toggle is worth flipping, so it has to
    // survive the seam even while the overlay itself is drawing nothing.
    it('forwards the count while the overlay is off and the run starts are empty', () => {
        lateDeallocationOverlayMock.mockReturnValue(buildOverlayResult({ runStartCount: 4 }));

        renderRenderer();

        const props = getListProps();
        expect(props.lateDeallocationRunCount).toBe(4);
        expect(props.lateDeallocationRunStarts).toEqual([]);
    });
});
