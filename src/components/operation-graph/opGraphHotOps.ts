// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type HotOpsSettings, HotOpsSort } from '../../definitions/HotOps';
import type { OpGraphPerfOverlay } from './opGraphPerfOverlay';

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

/** The rows to list: the limit takes the slowest, and the sort only orders what it kept. */
export const getVisibleHotOpRows = (
    rows: readonly HotOpRow[],
    { limit, sort, hideUnlinked }: Omit<HotOpsSettings, 'limit'> & { limit: number | null },
): HotOpRow[] => {
    const eligible = hideUnlinked ? rows.filter((row) => row.rank !== null) : rows;
    const kept = limit === null ? [...eligible] : eligible.slice(0, limit);
    return sort === HotOpsSort.OPERATION_ID ? kept.sort((a, b) => a.operationId - b.operationId) : kept;
};
