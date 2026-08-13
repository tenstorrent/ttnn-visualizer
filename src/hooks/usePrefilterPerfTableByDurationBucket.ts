// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { DurationBucket } from '../definitions/PerfDurationHistogram';
import { PerfTablePrefilterOptions } from '../definitions/PerformanceCharts';
import { toggleListMembership } from '../functions/toggleListMembership';
import { durationBucketFilterListAtom, isStackedViewAtom } from '../store/app';
import { useShowPerfTable } from './useShowPerfTable';

/**
 * Default path replaces the selection and navigates to the Table tab. Pass `{ amend: true }` to
 * toggle membership instead and stay on the Charts tab (shift-click / click-again-to-clear on the
 * histogram controls — #1868).
 *
 * Also leaves the stacked view, which aggregates away the per-op device time this filters on:
 * staying there would show the table neither filtered nor carrying the tag that explains why,
 * then apply the filter the moment the user switched back.
 */
export function usePrefilterPerfTableByDurationBucket() {
    const showPerfTable = useShowPerfTable();
    const setFilters = useSetAtom(durationBucketFilterListAtom);
    const setIsStackedView = useSetAtom(isStackedViewAtom);

    return useCallback(
        (minUs: DurationBucket['minUs'], options?: PerfTablePrefilterOptions) => {
            if (options?.amend) {
                setFilters((current) => toggleListMembership(current, minUs));
            } else {
                setFilters([minUs]);
            }

            setIsStackedView(false);

            if (!options?.amend) {
                showPerfTable();
            }
        },
        [setFilters, setIsStackedView, showPerfTable],
    );
}
