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
export const getAdjacentOperationIds = (
    nodeIndex: readonly OpGraphNodeIndexEntry[],
    selectedOperationId: number | null,
): AdjacentOperationIds => {
    const position =
        selectedOperationId === null
            ? -1
            : nodeIndex.findIndex(
                  (entry) =>
                      entry.operationId === selectedOperationId ||
                      (entry.memberOperationIds !== undefined &&
                          entry.memberOperationIds.includes(selectedOperationId)),
              );

    if (position === -1) {
        return { previousOperationId: null, nextOperationId: nodeIndex[0]?.operationId ?? null };
    }

    return {
        previousOperationId: nodeIndex[position - 1]?.operationId ?? null,
        nextOperationId: nodeIndex[position + 1]?.operationId ?? null,
    };
};
