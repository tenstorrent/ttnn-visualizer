// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { AllocationFailure, AllocationFailureListing } from '../model/AllocationFailure';
import { getAllocationFailureDetail } from '../functions/parseAllocationFailure';
import { isMemoryReportLinked } from '../functions/linkableDeviceOperations';
import { useOpToPerfIdFiltered, useOpToPerfIdForPerfTable, useOperationsList } from './useAPI';

export interface AllocationFailures {
    listings: AllocationFailureListing[];
    allocationFailureByOpId: Map<number, AllocationFailure>;
}

const EMPTY_RESULT: AllocationFailures = Object.freeze({
    listings: [],
    allocationFailureByOpId: new Map<number, AllocationFailure>(),
});

const countLinkedRowsByOpId = (opIdsMap: { perfId?: string; opId: number }[]): Map<number, number> => {
    const countByOpId = new Map<number, number>();

    for (const { opId, perfId } of opIdsMap) {
        if (perfId !== undefined) {
            countByOpId.set(opId, (countByOpId.get(opId) ?? 0) + 1);
        }
    }

    return countByOpId;
};

/**
 * Allocation failures recorded in the active memory report, for the performance view.
 *
 * Empty unless the memory report is linked to the performance report: a failure from an
 * unrelated run would be blamed on this one. The link is the pinned one, so the answer
 * does not move with the table's view filters. Rows are counted through the table's own
 * lookup, so with devices unmerged the count matches the rows the table flags.
 */
export const useAllocationFailures = (): AllocationFailures => {
    const { data: operations } = useOperationsList();
    const opIdsMap = useOpToPerfIdFiltered();
    const perfTableOpIdsMap = useOpToPerfIdForPerfTable();

    return useMemo(() => {
        if (!isMemoryReportLinked(operations, opIdsMap)) {
            return EMPTY_RESULT;
        }

        const ranDeviceOperationCountByOpId = countLinkedRowsByOpId(opIdsMap);
        const linkedRowCountByOpId = countLinkedRowsByOpId(perfTableOpIdsMap);

        const listings: AllocationFailureListing[] = [];
        const allocationFailureByOpId = new Map<number, AllocationFailure>();

        for (const operation of operations) {
            const detail = getAllocationFailureDetail(operation);

            if (detail) {
                allocationFailureByOpId.set(operation.id, detail.failure);
                listings.push({
                    ...detail,
                    ranDeviceOperationCount: ranDeviceOperationCountByOpId.get(operation.id) ?? 0,
                    linkedRowCount: linkedRowCountByOpId.get(operation.id) ?? 0,
                });
            }
        }

        return listings.length > 0 ? { listings, allocationFailureByOpId } : EMPTY_RESULT;
    }, [operations, opIdsMap, perfTableOpIdsMap]);
};
