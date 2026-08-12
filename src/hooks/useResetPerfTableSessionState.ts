// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import {
    bufferTypeFilterListAtom,
    durationBucketFilterListAtom,
    layoutFilterListAtom,
    mathFilterListAtom,
    rawOpCodeFilterListAtom,
    selectedPerfRowIdAtom,
} from '../store/app';

/** Clears table selection and all PerfReport chip filters (op code, math, buffer, layout, duration). */
export function useResetPerfTableSessionState() {
    const setSelectedPerfRowId = useSetAtom(selectedPerfRowIdAtom);
    const setMathFilterList = useSetAtom(mathFilterListAtom);
    const setRawOpCodeFilterList = useSetAtom(rawOpCodeFilterListAtom);
    const setBufferTypeFilterList = useSetAtom(bufferTypeFilterListAtom);
    const setLayoutFilterList = useSetAtom(layoutFilterListAtom);
    const setDurationBucketFilterList = useSetAtom(durationBucketFilterListAtom);

    return useCallback(() => {
        setSelectedPerfRowId(null);
        setMathFilterList([]);
        setRawOpCodeFilterList([]);
        setBufferTypeFilterList([]);
        setLayoutFilterList([]);
        setDurationBucketFilterList([]);
    }, [
        setSelectedPerfRowId,
        setMathFilterList,
        setRawOpCodeFilterList,
        setBufferTypeFilterList,
        setLayoutFilterList,
        setDurationBucketFilterList,
    ]);
}
