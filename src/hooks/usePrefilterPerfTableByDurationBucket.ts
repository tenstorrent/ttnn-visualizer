// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { DurationBucket } from '../definitions/PerfDurationHistogram';
import { durationBucketFilterListAtom, isStackedViewAtom } from '../store/app';
import { useShowPerfTable } from './useShowPerfTable';

/**
 * Replaces rather than unions the selection: the click leaves the charts tab immediately, so
 * there is no opportunity to add a second bucket before the table is shown. Union and clear are
 * reachable from the Table tab chip instead. That is the current scope boundary rather than a
 * settled design conclusion — shift-click union from the histogram is #1868, and it needs this
 * navigation suppressed to be usable.
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
        (minUs: DurationBucket['minUs']) => {
            setFilters([minUs]);
            setIsStackedView(false);
            showPerfTable();
        },
        [setFilters, setIsStackedView, showPerfTable],
    );
}
