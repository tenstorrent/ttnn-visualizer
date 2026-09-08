// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { showDeallocationReportAtom } from '../store/app';
import { TensorDeallocationReport } from '../model/BufferSummary';
import { LateDeallocationRunStart } from '../definitions/LateDeallocation';
import { selectLateDeallocationRunStarts } from '../functions/lateDeallocation';
import { useGetTensorDeallocationReportByOperation } from './useAPI';

const EMPTY_TENSOR_DEALLOCATION_REPORT: TensorDeallocationReport[] = [];
const EMPTY_RUN_STARTS: readonly LateDeallocationRunStart[] = [];

export interface UseLateDeallocationOverlayParams {
    /** Rows as rendered by the buffer summary list, in display order. */
    operations: readonly { id: number }[];
}

export interface UseLateDeallocationOverlayResult {
    /** Per-row report driving the row canvas hatch. Empty while the toggle is off. */
    getTensorDeallocationReport: (operationId: number) => TensorDeallocationReport[];
    /**
     * Rows the navigation rail plots. Empty while the toggle is off, so the
     * rail appears with the hatching it points at rather than sending the user
     * to rows that look unremarkable.
     */
    runStarts: readonly LateDeallocationRunStart[];
    /**
     * How many rows qualify, counted whether or not the overlay is on — the
     * count is what tells the user the toggle is worth flipping.
     */
    runStartCount: number;
}

/**
 * Single owner of the late-deallocation data for the buffer summary: the
 * per-row report the canvas hatches from, the rows the navigation rail plots,
 * and the count shown on the toggle.
 *
 * Deliberately the only caller of `useGetTensorDeallocationReportByOperation`
 * in this subtree. That hook chains through
 * `useCreateTensorsByOperationByIdList`, which rebuilds per-operation tensor
 * maps across the whole report inside `useMemo` — React Query caches the
 * fetch, not the derivation, so a second call in the same component pays the
 * full cost again.
 */
export const useLateDeallocationOverlay = ({
    operations,
}: UseLateDeallocationOverlayParams): UseLateDeallocationOverlayResult => {
    const showDeallocationReport = useAtomValue(showDeallocationReportAtom);
    const { lateDeallocationsByOperation } = useGetTensorDeallocationReportByOperation();

    const runStarts = useMemo(
        () => selectLateDeallocationRunStarts({ operations, reportsByOpId: lateDeallocationsByOperation }),
        [operations, lateDeallocationsByOperation],
    );

    const getTensorDeallocationReport = useCallback(
        (operationId: number) =>
            showDeallocationReport
                ? lateDeallocationsByOperation.get(operationId) || EMPTY_TENSOR_DEALLOCATION_REPORT
                : EMPTY_TENSOR_DEALLOCATION_REPORT,
        [showDeallocationReport, lateDeallocationsByOperation],
    );

    return {
        getTensorDeallocationReport,
        runStarts: showDeallocationReport ? runStarts : EMPTY_RUN_STARTS,
        runStartCount: runStarts.length,
    };
};
