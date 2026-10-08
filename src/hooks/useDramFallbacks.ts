// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { AllocationFailure } from '../model/AllocationFailure';
import { DramFallback } from '../model/DramFallback';
import { getDramFallbacks } from '../functions/getDramFallbacks';
import { useOpToPerfIdFiltered, useOperationsList } from './useAPI';

const EMPTY_RESULT: Map<number, DramFallback> = new Map<number, DramFallback>();

/**
 * Likely DRAM fallbacks in the active memory report, keyed by operation id.
 *
 * Empty unless the memory report is linked to the performance report, as for
 * `useAllocationFailures`: a fallback from an unrelated run would be blamed on this one,
 * and nothing reading the map should have to re-check the link itself.
 * Takes the failures as an argument so they are parsed once.
 */
export const useDramFallbacks = (
    allocationFailureByOpId: Map<number, AllocationFailure>,
): Map<number, DramFallback> => {
    const { data: operations } = useOperationsList();
    const opIdsMap = useOpToPerfIdFiltered();

    return useMemo(
        () =>
            operations?.length && opIdsMap.length > 0
                ? getDramFallbacks(operations, allocationFailureByOpId)
                : EMPTY_RESULT,
        [operations, opIdsMap, allocationFailureByOpId],
    );
};
