// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { DurationBucket } from '../definitions/PerfDurationHistogram';
import { PerfTablePrefilterOptions } from '../definitions/PerformanceCharts';
import { resolvePerfTablePrefilter } from '../functions/resolvePerfTablePrefilter';
import { durationBucketFilterListAtom, isStackedViewAtom } from '../store/app';
import { useShowPerfTable } from './useShowPerfTable';

/**
 * Applies the gesture the caller reports (see PerfTablePrefilterOptions): a plain click replaces the
 * selection and navigates to the Table tab, shift and click-again-to-clear amend it and stay on the
 * Charts tab (#1868).
 *
 * A resulting selection also leaves the stacked view, which aggregates away the per-op device time
 * this filters on: staying there would show the table neither filtered nor carrying the tag that
 * explains why, then apply the filter the moment the user switched back. Clearing the filter has
 * nothing to explain, so it leaves the view mode alone rather than reverting it off-screen.
 */
export function usePrefilterPerfTableByDurationBucket() {
    const showPerfTable = useShowPerfTable();
    const [filters, setFilters] = useAtom(durationBucketFilterListAtom);
    const setIsStackedView = useSetAtom(isStackedViewAtom);

    return useCallback(
        (minUs: DurationBucket['minUs'], options?: PerfTablePrefilterOptions<DurationBucket['minUs']>) => {
            const { selection, shouldShowPerfTable } = resolvePerfTablePrefilter(filters, minUs, options);

            setFilters(selection);

            if (selection.length > 0) {
                setIsStackedView(false);
            }

            if (shouldShowPerfTable) {
                showPerfTable();
            }
        },
        [filters, setFilters, setIsStackedView, showPerfTable],
    );
}
