// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { OpGraphNodeIndexEntry } from './opGraphTypes';

export interface AdjacentOperationIds {
    previousOperationId: number | null;
    nextOperationId: number | null;
}

/**
 * @description The operations either side of the selection in render order, for
 * the toolbar's prev/next steppers. Both are `null` past the respective end.
 *
 * A folded block is indexed under its first member, but the selection may sit on
 * any member — the rebuild keeps a selected op when a block closes over it. An
 * exact-id lookup therefore missed the entry and `next` restarted from the
 * graph's first node, so a block matches on its members too. #1944
 */
/**
 * @description Render position of every operation the index can be selected by:
 * an entry's own id, plus each member id a folded block stands in for. Built once
 * per index rather than scanned per stepper render.
 */
export const buildPositionByOperationId = (nodeIndex: readonly OpGraphNodeIndexEntry[]): Map<number, number> => {
    const positionByOperationId = new Map<number, number>();
    nodeIndex.forEach((entry, position) => {
        // First-wins throughout, matching the `findIndex` this replaces.
        if (!positionByOperationId.has(entry.operationId)) {
            positionByOperationId.set(entry.operationId, position);
        }
        for (const memberOperationId of entry.memberOperationIds ?? []) {
            if (!positionByOperationId.has(memberOperationId)) {
                positionByOperationId.set(memberOperationId, position);
            }
        }
    });
    return positionByOperationId;
};

export const getAdjacentOperationIds = (
    nodeIndex: readonly OpGraphNodeIndexEntry[],
    selectedOperationId: number | null,
    positionByOperationId: ReadonlyMap<number, number> = buildPositionByOperationId(nodeIndex),
): AdjacentOperationIds => {
    const position = selectedOperationId === null ? -1 : (positionByOperationId.get(selectedOperationId) ?? -1);

    if (position === -1) {
        return { previousOperationId: null, nextOperationId: nodeIndex[0]?.operationId ?? null };
    }

    return {
        previousOperationId: nodeIndex[position - 1]?.operationId ?? null,
        nextOperationId: nodeIndex[position + 1]?.operationId ?? null,
    };
};
