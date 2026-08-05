// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { DurationBucket } from '../definitions/PerfDurationHistogram';
import { durationBucketFilterListAtom } from '../store/app';
import { useShowPerfTable } from './useShowPerfTable';

/**
 * Replaces rather than unions the selection: the click leaves the charts tab immediately,
 * so there is no opportunity to add a second bucket before the table is shown.
 */
export function usePrefilterPerfTableByDurationBucket() {
    const showPerfTable = useShowPerfTable();
    const setFilters = useSetAtom(durationBucketFilterListAtom);

    return useCallback(
        (minUs: DurationBucket['minUs']) => {
            setFilters([minUs]);
            showPerfTable();
        },
        [setFilters, showPerfTable],
    );
}
