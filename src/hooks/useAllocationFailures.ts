// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { AllocationFailure, AllocationFailureDetail, AllocationFailureListing } from '../model/AllocationFailure';
import { getAllocationFailureDetail } from '../functions/parseAllocationFailure';
import { isMemoryReportLinked } from '../functions/linkableDeviceOperations';
import { useOpToPerfIdFiltered, useOperationsList } from './useAPI';

export interface AllocationFailures {
    listings: AllocationFailureListing[];
    allocationFailureByOpId: Map<number, AllocationFailure>;
}

const EMPTY_RESULT: AllocationFailures = Object.freeze({
    listings: [],
    allocationFailureByOpId: new Map<number, AllocationFailure>(),
});

type OpIdsMap = ReturnType<typeof useOpToPerfIdFiltered>;

const countLinkedRowsByOpId = (opIdsMap: OpIdsMap): Map<number, number> => {
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
 * lookup, so with devices unmerged the count matches the rows the table flags. Takes that
 * lookup as an argument so the route groups the unmerged rows once.
 */
export const useAllocationFailures = (perfTableOpIdsMap: OpIdsMap): AllocationFailures => {
    const { data: operations } = useOperationsList();
    const opIdsMap = useOpToPerfIdFiltered();

    // Apart from the row counts, so a merge toggle keeps the failure map and does not
    // make `useDramFallbacks` rescan.
    const failures = useMemo(() => {
        if (!isMemoryReportLinked(operations, opIdsMap)) {
            return null;
        }

        const ranDeviceOperationCountByOpId = countLinkedRowsByOpId(opIdsMap);
        const details: (AllocationFailureDetail & { ranDeviceOperationCount: number })[] = [];
        const allocationFailureByOpId = new Map<number, AllocationFailure>();

        for (const operation of operations) {
            const detail = getAllocationFailureDetail(operation);

            if (detail) {
                allocationFailureByOpId.set(operation.id, detail.failure);
                details.push({
                    ...detail,
                    ranDeviceOperationCount: ranDeviceOperationCountByOpId.get(operation.id) ?? 0,
                });
            }
        }

        return details.length > 0 ? { details, allocationFailureByOpId } : null;
    }, [operations, opIdsMap]);

    return useMemo(() => {
        if (!failures) {
            return EMPTY_RESULT;
        }

        const linkedRowCountByOpId = countLinkedRowsByOpId(perfTableOpIdsMap);

        return {
            listings: failures.details.map((detail) => ({
                ...detail,
                linkedRowCount: linkedRowCountByOpId.get(detail.failure.operationId) ?? 0,
            })),
            allocationFailureByOpId: failures.allocationFailureByOpId,
        };
    }, [failures, perfTableOpIdsMap]);
};
