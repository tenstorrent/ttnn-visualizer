// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { AllocationFailure } from '../model/AllocationFailure';
import { DramFallback } from '../model/DramFallback';
import { getDramFallbacks } from '../functions/detectDramFallbacks';
import { useOperationsList } from './useAPI';

const EMPTY_RESULT: Map<number, DramFallback> = new Map<number, DramFallback>();

/**
 * Likely DRAM fallbacks in the active memory report, keyed by operation id.
 *
 * Unlike `useAllocationFailures`, no linked-report gate: a fallback only reaches the table
 * through `enrichRowData`, which attaches it by linked op id, so an unrelated run shows none.
 * Takes the failures as an argument so they are parsed once.
 */
export const useDramFallbacks = (
    allocationFailureByOpId: Map<number, AllocationFailure>,
): Map<number, DramFallback> => {
    const { data: operations } = useOperationsList();

    return useMemo(
        () => (operations?.length ? getDramFallbacks(operations, allocationFailureByOpId) : EMPTY_RESULT),
        [operations, allocationFailureByOpId],
    );
};
