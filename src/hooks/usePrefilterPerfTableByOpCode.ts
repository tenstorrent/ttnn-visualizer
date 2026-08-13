// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { PerfTablePrefilterOptions } from '../definitions/PerformanceCharts';
import { toggleListMembership } from '../functions/toggleListMembership';
import { rawOpCodeFilterListAtom } from '../store/app';
import { useShowPerfTable } from './useShowPerfTable';

/**
 * Default path replaces the selection and navigates to the Table tab. Pass `{ amend: true }` to
 * toggle membership instead and stay put — same shape as usePrefilterPerfTableByDurationBucket.
 */
export function usePrefilterPerfTableByOpCode() {
    const showPerfTable = useShowPerfTable();
    const setFilters = useSetAtom(rawOpCodeFilterListAtom);

    return useCallback(
        (opCode: string, options?: PerfTablePrefilterOptions) => {
            if (!opCode) {
                return;
            }

            if (options?.amend) {
                setFilters((current) => toggleListMembership(current, opCode));
            } else {
                setFilters([opCode]);
            }

            if (!options?.amend) {
                showPerfTable();
            }
        },
        [setFilters, showPerfTable],
    );
}
