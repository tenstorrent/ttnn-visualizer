// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { CSSProperties } from 'react';

import { PerfOverlayStatus } from '../../definitions/PerfOverlayStatus';
import { formatDuration } from '../../functions/formatting';
import {
    type OpPerfAggregate,
    type OpPerfScore,
    type PerfOverlaySource,
    aggregatePerfByOp,
    perfColorScale,
    scoreOps,
} from '../../functions/perfOverlay';

// Perf gets its own channel — an inset pseudo-element bar — since the fill
// belongs to the I/O highlight and the border to selection. Driving it from a
// custom property leaves the node geometry, and so the Dagre layout, alone. #1880
export const PERF_BAR_SCALE_VAR = '--op-graph-perf-scale';
export const PERF_BAR_COLOR_VAR = '--op-graph-perf-color';

// Sizes inside the scaled viewport are graph units, not screen pixels. The SCSS
// divides by the live zoom to hold an on-screen floor, without which the
// encoding washes out at exactly the zoom a whole report fits in. #1610
export const PERF_BAR_ZOOM_VAR = '--op-graph-perf-zoom';

export const NO_PERF_DATA_LABEL = 'No perf data';

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
 * Restricting to `graphOperationIds` makes the ramp answer "where is the time
 * *in this view*": a range selection or hidden deallocates would otherwise
 * anchor the scale to a max the user cannot see, and count "N of M" against the
 * wrong denominator.
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

/**
 * Style patch by node id, or `null` when the overlay is off so the caller can
 * skip the styling pass. Custom properties only: `className` already carries
 * selection and the I/O highlight, and the filter dim is inherited.
 */
export const buildPerfNodeStyleByNodeId = (
    overlay: OpGraphPerfOverlay,
    isActive: boolean,
): Map<string, CSSProperties> | null => {
    if (!isActive) {
        return null;
    }
    const styleByNodeId = new Map<string, CSSProperties>();
    for (const [opId, score] of overlay.scoreByOpId) {
        // `CSSProperties` has no index signature for custom properties.
        styleByNodeId.set(String(opId), {
            [PERF_BAR_SCALE_VAR]: score.t,
            [PERF_BAR_COLOR_VAR]: perfColorScale(score.t),
        } as CSSProperties);
    }
    return styleByNodeId;
};

/** Duration, rank among the linked ops, and share of their total. #1610 */
export const getPerfHoverLabel = (overlay: OpGraphPerfOverlay, operationId: number): string => {
    const aggregate = overlay.aggregatesByOpId.get(operationId);
    if (aggregate === undefined) {
        return NO_PERF_DATA_LABEL;
    }
    const rank = overlay.rankByOpId.get(operationId);
    const share = overlay.totalNs > 0 ? (aggregate.deviceTimeNs / overlay.totalNs) * 100 : 0;
    return `${formatDuration(aggregate.deviceTimeNs)} · #${rank} of ${overlay.linkedOpCount} · ${share.toFixed(1)}% of total`;
};
