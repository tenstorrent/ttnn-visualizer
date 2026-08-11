// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLateDeallocationOverlay } from '../src/hooks/useLateDeallocationOverlay';
import { useGetTensorDeallocationReportByOperation } from '../src/hooks/useAPI';
import { showDeallocationReportAtom } from '../src/store/app';
import { TensorDeallocationReport } from '../src/model/BufferSummary';
import { AtomProvider } from './helpers/atomProvider';
import { buildTensorDeallocationReport } from './helpers/lateDeallocationFixtures';

vi.mock('../src/hooks/useAPI', () => ({
    useGetTensorDeallocationReportByOperation: vi.fn(),
}));

const operations = [{ id: 1 }, { id: 2 }, { id: 3 }];

const renderOverlay = (showDeallocationReport: boolean) =>
    renderHook(() => useLateDeallocationOverlay({ operations }), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
            <AtomProvider initialValues={[[showDeallocationReportAtom, showDeallocationReport]]}>
                {children}
            </AtomProvider>
        ),
    });

const mockReports = (lateDeallocationsByOperation: Map<number, TensorDeallocationReport[]>) => {
    vi.mocked(useGetTensorDeallocationReportByOperation).mockReturnValue({
        lateDeallocationsByOperation,
        nonDeallocatedTensorList: new Map(),
    });
};

beforeEach(() => {
    vi.mocked(useGetTensorDeallocationReportByOperation).mockReset();
    mockReports(new Map([[2, [buildTensorDeallocationReport({ id: 7, lastOperationId: 2 })]]]));
});

describe('useLateDeallocationOverlay', () => {
    it('returns the run starts and the per-row report when the overlay is on', () => {
        const { result } = renderOverlay(true);

        expect(result.current.runStarts).toHaveLength(1);
        expect(result.current.runStarts[0]).toMatchObject({ opId: 2, rowIndex: 1 });
        expect(result.current.getTensorDeallocationReport(2).map((tensor) => tensor.id)).toEqual([7]);
    });

    it('withholds the rail and the hatch report when the overlay is off', () => {
        const { result } = renderOverlay(false);

        expect(result.current.runStarts).toEqual([]);
        expect(result.current.getTensorDeallocationReport(2)).toEqual([]);
    });

    // The count is what tells the user the toggle is worth flipping, so it is
    // deliberately not gated on the toggle the way the drawn overlay is.
    it('counts the run starts whether or not the overlay is on', () => {
        expect(renderOverlay(true).result.current.runStartCount).toBe(1);
        expect(renderOverlay(false).result.current.runStartCount).toBe(1);
    });

    it('reports an empty array for a row with nothing stale', () => {
        const { result } = renderOverlay(true);

        expect(result.current.getTensorDeallocationReport(1)).toEqual([]);
    });

    // `BufferSummaryRow` is memoised on this getter's result, so a fresh array
    // per call would re-render every row on every scroll tick.
    it('keeps the getter and its results referentially stable across renders', () => {
        const { result, rerender } = renderOverlay(true);
        const initialGetter = result.current.getTensorDeallocationReport;
        const initialReport = initialGetter(2);
        const initialEmptyReport = initialGetter(1);

        rerender();

        expect(result.current.getTensorDeallocationReport).toBe(initialGetter);
        expect(result.current.getTensorDeallocationReport(2)).toBe(initialReport);
        expect(result.current.getTensorDeallocationReport(1)).toBe(initialEmptyReport);
    });
});
