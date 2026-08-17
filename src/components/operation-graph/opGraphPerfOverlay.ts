// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PerfOverlayStatus } from '../../definitions/PerfOverlayStatus';
import {
    type OpPerfAggregate,
    type OpPerfScore,
    type PerfOverlaySource,
    aggregatePerfByOp,
    scoreOps,
} from '../../functions/perfOverlay';

export interface OpGraphPerfOverlay {
    status: PerfOverlayStatus;
    aggregatesByOpId: Map<number, OpPerfAggregate>;
    scoreByOpId: Map<number, OpPerfScore>;
    /** 1 is the slowest op. Ranks only cover ops the graph actually shows. */
    rankByOpId: Map<number, number>;
    minNs: number;
    maxNs: number;
    /** Graph ops carrying a perf row, and graph ops in total — the "N of M" pair. */
    linkedOpCount: number;
    totalOpCount: number;
    /** Summed kernel duration across linked ops, for the per-op share. */
    totalNs: number;
}

const EMPTY_OVERLAY: OpGraphPerfOverlay = {
    status: PerfOverlayStatus.UNAVAILABLE,
    aggregatesByOpId: new Map<number, OpPerfAggregate>(),
    scoreByOpId: new Map<number, OpPerfScore>(),
    rankByOpId: new Map<number, number>(),
    minNs: 0,
    maxNs: 0,
    linkedOpCount: 0,
    totalOpCount: 0,
    totalNs: 0,
};

/**
 * Fold the perf rows down to everything the graph overlay needs, restricted to
 * the ops the graph is currently showing.
 *
 * Restricting to `graphOperationIds` is what makes the ramp answer "where is
 * the time *in this view*": an operation-range selection or hidden deallocates
 * would otherwise leave the scale anchored to a max the user cannot see, and
 * the "N of M linked" count would compare against the wrong denominator.
 */
export const buildOpGraphPerfOverlay = (
    rows: PerfOverlaySource[] | undefined,
    isPerfReportLoaded: boolean,
    graphOperationIds: number[],
): OpGraphPerfOverlay => {
    if (!isPerfReportLoaded) {
        return { ...EMPTY_OVERLAY, totalOpCount: graphOperationIds.length };
    }

    const graphOpIds = new Set(graphOperationIds);
    const aggregatesByOpId = new Map<number, OpPerfAggregate>();
    for (const [opId, aggregate] of aggregatePerfByOp(rows ?? [])) {
        if (graphOpIds.has(opId)) {
            aggregatesByOpId.set(opId, aggregate);
        }
    }

    if (aggregatesByOpId.size === 0) {
        return {
            ...EMPTY_OVERLAY,
            status: PerfOverlayStatus.UNLINKED,
            totalOpCount: graphOperationIds.length,
        };
    }

    const { scoreByOpId, minNs, maxNs } = scoreOps(aggregatesByOpId);

    const rankByOpId = new Map<number, number>();
    let totalNs = 0;
    const slowestFirst = Array.from(aggregatesByOpId.values()).sort((a, b) => b.deviceTimeNs - a.deviceTimeNs);
    slowestFirst.forEach((aggregate, index) => {
        rankByOpId.set(aggregate.opId, index + 1);
        totalNs += aggregate.deviceTimeNs;
    });

    return {
        status: PerfOverlayStatus.READY,
        aggregatesByOpId,
        scoreByOpId,
        rankByOpId,
        minNs,
        maxNs,
        linkedOpCount: aggregatesByOpId.size,
        totalOpCount: graphOperationIds.length,
        totalNs,
    };
};
