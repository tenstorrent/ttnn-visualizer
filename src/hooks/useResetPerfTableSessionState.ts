// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import {
    bufferTypeFilterListAtom,
    layoutFilterListAtom,
    mathFilterListAtom,
    rawOpCodeFilterListAtom,
    selectedPerfRowIdAtom,
} from '../store/app';

/** Clears table selection and all PerfReport chip filters (op code, math, buffer, layout). */
export function useResetPerfTableSessionState() {
    const setSelectedPerfRowId = useSetAtom(selectedPerfRowIdAtom);
    const setMathFilterList = useSetAtom(mathFilterListAtom);
    const setRawOpCodeFilterList = useSetAtom(rawOpCodeFilterListAtom);
    const setBufferTypeFilterList = useSetAtom(bufferTypeFilterListAtom);
    const setLayoutFilterList = useSetAtom(layoutFilterListAtom);

    return useCallback(() => {
        setSelectedPerfRowId(null);
        setMathFilterList([]);
        setRawOpCodeFilterList([]);
        setBufferTypeFilterList([]);
        setLayoutFilterList([]);
    }, [setSelectedPerfRowId, setMathFilterList, setRawOpCodeFilterList, setBufferTypeFilterList, setLayoutFilterList]);
}
