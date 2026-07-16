// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { PerfTabIds } from '../definitions/Performance';
import { perfSelectedTabAtom, rawOpCodeFilterListAtom } from '../store/app';

export function usePrefilterPerfTableByOpCode() {
    const setTab = useSetAtom(perfSelectedTabAtom);
    const setFilters = useSetAtom(rawOpCodeFilterListAtom);

    return useCallback(
        (opCode: string) => {
            if (!opCode) {
                return;
            }

            setFilters([opCode]);
            setTab(PerfTabIds.TABLE);
            // Charts tab content (especially Operation Types) sits far down the page
            // Preserving scroll position across tab swap would land the table view mid-page
            window.requestAnimationFrame(() => {
                window.scrollTo({ top: 0, left: 0 });
            });
        },
        [setFilters, setTab],
    );
}
