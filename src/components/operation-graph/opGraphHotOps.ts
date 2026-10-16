// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type HotOpsMarking, type HotOpsSettings, HotOpsSort } from '../../definitions/HotOps';
import type { OpGraphPerfOverlay } from './opGraphPerfOverlay';
import { memberOperationIdsOf } from './opGraphMemberTime';
import type { OpGraphNodeIndexEntry } from './opGraphTypes';

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

type HotOpsRowFilter = Omit<HotOpsMarking, 'limit'> & { limit: number | null };

/** The rows the list keeps, slowest first: the limit takes the slowest of those not hidden. */
const getKeptHotOpRows = (rows: readonly HotOpRow[], { limit, hideUnlinked }: HotOpsRowFilter): readonly HotOpRow[] => {
    const eligible = hideUnlinked ? rows.filter((row) => row.rank !== null) : rows;
    return limit === null ? eligible : eligible.slice(0, limit);
};

/** The rows to list: the limit takes the slowest, and the sort only orders what it kept. */
export const getVisibleHotOpRows = (
    rows: readonly HotOpRow[],
    { sort, ...filter }: HotOpsRowFilter & Pick<HotOpsSettings, 'sort'>,
): readonly HotOpRow[] => {
    const kept = getKeptHotOpRows(rows, filter);
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
export const getMarkedHotOpRanks = (rows: readonly HotOpRow[], filter: HotOpsRowFilter): Map<number, number | null> =>
    new Map(getKeptHotOpRows(rows, filter).map((row) => [row.operationId, row.rank]));

/**
 * Each indexed node's badge rank: the best rank among the listed ops it stands for, read over the same
 * members as the perf bar and the critical path. A ranked op outranks an unranked one; an unlisted node is absent.
 */
export const buildHotRankByNodeId = (
    rankByOperationId: ReadonlyMap<number, number | null>,
    nodeIndex: readonly OpGraphNodeIndexEntry[],
): Map<string, number | null> => {
    const rankByNodeId = new Map<string, number | null>();
    for (const entry of nodeIndex) {
        let best: number | null | undefined;
        for (const operationId of memberOperationIdsOf(entry)) {
            const rank = rankByOperationId.get(operationId);
            if (rank !== undefined && (best === undefined || best === null || (rank !== null && rank < best))) {
                best = rank;
            }
        }
        if (best !== undefined) {
            rankByNodeId.set(entry.id, best);
        }
    }
    return rankByNodeId;
};
