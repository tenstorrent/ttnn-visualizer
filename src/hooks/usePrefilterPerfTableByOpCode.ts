// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useAtom } from 'jotai';
import { PerfTablePrefilterOptions } from '../definitions/PerformanceCharts';
import { resolvePerfTablePrefilter } from '../functions/resolvePerfTablePrefilter';
import { rawOpCodeFilterListAtom } from '../store/app';
import { useShowPerfTable } from './useShowPerfTable';

/**
 * Applies the gesture the caller reports (see PerfTablePrefilterOptions): a plain click replaces the
 * selection and navigates to the Table tab, shift and click-again-to-clear amend it and stay on the
 * Charts tab — the same shape as usePrefilterPerfTableByDurationBucket.
 *
 * Unlike that hook this one leaves the stacked view alone, because the stacked table honours the raw
 * op code filter (`filteredStackedRows`, PerfReport.tsx) while it has no per-op device time for the
 * bucket filter to act on.
 */
export function usePrefilterPerfTableByOpCode() {
    const showPerfTable = useShowPerfTable();
    const [filters, setFilters] = useAtom(rawOpCodeFilterListAtom);

    return useCallback(
        (opCode: string, options?: PerfTablePrefilterOptions<string>) => {
            if (!opCode) {
                return;
            }

            const { selection, shouldShowPerfTable } = resolvePerfTablePrefilter(filters, opCode, options);

            setFilters(selection);

            if (shouldShowPerfTable) {
                showPerfTable();
            }
        },
        [filters, setFilters, showPerfTable],
    );
}
