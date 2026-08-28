// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The operations a rendered node stands for: a folded block's members, or the
 * node's own operation. Three call sites shared this `?? [operationId]` shape and
 * the sum built on it — the perf overlay's bars, the critical path's weights, and
 * the panel's selected-block total. #1944
 */
export interface MemberBearingNode {
    operationId: number;
    memberOperationIds?: number[];
}

export const memberOperationIdsOf = (node: MemberBearingNode): readonly number[] =>
    node.memberOperationIds ?? [node.operationId];

/** Device time across the given operations, counting an unlinked one as zero. */
export const sumDeviceTimeNs = (
    operationIds: readonly number[],
    deviceTimeNsOf: (operationId: number) => number | undefined,
): number => {
    let total = 0;
    for (const operationId of operationIds) {
        total += deviceTimeNsOf(operationId) ?? 0;
    }
    return total;
};
