// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { rawOpCodeFilterListAtom } from '../store/app';
import { useShowPerfTable } from './useShowPerfTable';

export function usePrefilterPerfTableByOpCode() {
    const showPerfTable = useShowPerfTable();
    const setFilters = useSetAtom(rawOpCodeFilterListAtom);

    return useCallback(
        (opCode: string) => {
            if (!opCode) {
                return;
            }

            setFilters([opCode]);
            showPerfTable();
        },
        [setFilters, showPerfTable],
    );
}
