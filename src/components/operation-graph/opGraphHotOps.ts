// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type HotOpsMarking, type HotOpsSettings, HotOpsSort } from '../../definitions/HotOps';
import type { OpGraphPerfOverlay } from './opGraphPerfOverlay';
import { type OpGraphFlowNode, OpGraphNodeType } from './opGraphTypes';

export interface HotOpRow {
    operationId: number;
    name: string;
    /** `null` for an operation on the graph with no linked perf row. */
    deviceTimeNs: number | null;
    rank: number | null;
}

/** Every operation on the graph, slowest first, then the ones without perf data by id. */
export const buildHotOpRows = (
    overlay: OpGraphPerfOverlay,
    graphOperationIds: readonly number[],
    operationNamesById: ReadonlyMap<number, string>,
): HotOpRow[] => {
    const nameOf = (operationId: number) => operationNamesById.get(operationId) ?? '';
    const linked = Array.from(overlay.rankByOpId, ([operationId, rank]) => ({
        operationId,
        name: nameOf(operationId),
        deviceTimeNs: overlay.aggregatesByOpId.get(operationId)?.deviceTimeNs ?? null,
        rank,
    })).sort((a, b) => a.rank - b.rank);

    const unlinkedIds = Array.from(new Set(graphOperationIds))
        .filter((operationId) => !overlay.rankByOpId.has(operationId))
        .sort((a, b) => a - b);

    return [
        ...linked,
        ...unlinkedIds.map((operationId) => ({
            operationId,
            name: nameOf(operationId),
            deviceTimeNs: null,
            rank: null,
        })),
    ];
};

const byOperationId = (a: HotOpRow, b: HotOpRow) => a.operationId - b.operationId;

/** The rows to list: the limit takes the slowest, and the sort only orders what it kept. */
export const getVisibleHotOpRows = (
    rows: readonly HotOpRow[],
    { limit, sort, hideUnlinked }: Pick<HotOpsSettings, 'sort' | 'hideUnlinked'> & { limit: number | null },
): HotOpRow[] => {
    const eligible = hideUnlinked ? rows.filter((row) => row.rank !== null) : rows;
    const kept = limit === null ? [...eligible] : eligible.slice(0, limit);
    if (sort === HotOpsSort.DURATION) {
        return kept;
    }
    // Ops without perf data stay last under either order.
    return [
        ...kept.filter((row) => row.rank !== null).sort(byOperationId),
        ...kept.filter((row) => row.rank === null).sort(byOperationId),
    ];
};

/** The rank of each op the list shows, `null` for one without perf data: the set the graph badges. #2085 */
export const getMarkedHotOpRanks = (
    rows: readonly HotOpRow[],
    marking: Pick<HotOpsMarking, 'hideUnlinked'> & { limit: number | null },
): Map<number, number | null> =>
    new Map(
        getVisibleHotOpRows(rows, { ...marking, sort: HotOpsSort.DURATION }).map((row) => [row.operationId, row.rank]),
    );

/**
 * The rank a node is badged with, or `undefined` when the list doesn't show it. A folded block wears its
 * slowest listed member's rank. A device operation carries its owner's id, so it is left to its owner.
 */
export const hotRankOf = (
    node: Pick<OpGraphFlowNode, 'type' | 'data'>,
    rankByOperationId: ReadonlyMap<number, number | null>,
): number | null | undefined => {
    if (node.type === OpGraphNodeType.BLOCK) {
        let best: number | null | undefined;
        for (const memberId of node.data.memberOperationIds ?? []) {
            const rank = rankByOperationId.get(memberId);
            if (rank !== undefined && (best === undefined || best === null || (rank !== null && rank < best))) {
                best = rank;
            }
        }
        return best;
    }
    if (node.type === OpGraphNodeType.OP || node.type === OpGraphNodeType.DEVICE_GROUP) {
        return rankByOperationId.get(node.data.operationId);
    }
    return undefined;
};
