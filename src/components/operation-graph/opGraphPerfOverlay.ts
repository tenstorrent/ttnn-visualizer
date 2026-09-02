// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { CSSProperties } from 'react';

import { type MemberBearingNode, memberOperationIdsOf, sumDeviceTimeNs } from './opGraphMemberTime';

import { NO_PERF_DATA_LABEL, PerfOverlayStatus } from '../../definitions/PerfOverlayStatus';
import { formatDuration } from '../../functions/formatting';
import {
    type OpPerfAggregate,
    type OpPerfScore,
    type PerfOverlaySource,
    aggregatePerfByOp,
    getRankComparator,
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

// d3-zoom emits a new scale nearly every frame, and the property above is
// inherited by every node's bar, so an unquantised write invalidates style for
// the whole graph per frame. Buckets are proportional rather than a fixed step
// because the zoom range spans 0.02–3: absolute tenths collapse the entire
// overview range to 0, which would divide by zero in the SCSS and drop the
// declaration. A 1.1 ratio holds the bar floor within ~5% of true. #1610
const PERF_ZOOM_BUCKET_RATIO = 1.1;

/**
 * Zoom rounded to the nearest proportional bucket. Falls back to `1` — the
 * SCSS's own fallback — for non-positive or non-finite input, so a degenerate
 * transform can never write a value that invalidates the bar geometry.
 */
export const getQuantisedPerfZoom = (zoom: number): number => {
    if (!Number.isFinite(zoom) || zoom <= 0) {
        return 1;
    }
    const bucket = Math.round(Math.log(zoom) / Math.log(PERF_ZOOM_BUCKET_RATIO));
    return PERF_ZOOM_BUCKET_RATIO ** bucket;
};

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
    const slowestFirst = Array.from(aggregatesByOpId.values()).sort(
        getRankComparator<OpPerfAggregate>((aggregate) => aggregate.deviceTimeNs),
    );
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

interface RenderedPerfNode extends MemberBearingNode {
    id: string;
}

/**
 * Device time per rendered node, a folded block summing its members. Nodes with
 * no linked row — or only zero-duration ones — are absent rather than zero, so
 * they neither take a bar nor drag the scale's floor down to nothing.
 */
const sumNsByRenderedNode = (overlay: OpGraphPerfOverlay, nodes: readonly RenderedPerfNode[]): Map<string, number> => {
    const nsByNodeId = new Map<string, number>();
    const deviceTimeNsOf = (operationId: number) => overlay.aggregatesByOpId.get(operationId)?.deviceTimeNs;
    for (const node of nodes) {
        const ns = sumDeviceTimeNs(memberOperationIdsOf(node), deviceTimeNsOf);
        if (ns > 0) {
            nsByNodeId.set(node.id, ns);
        }
    }
    return nsByNodeId;
};

/**
 * The duration range the node bars are actually drawn against, which the legend
 * is the key for. A folded block's bar stands for the sum of its members, so
 * that sum — not the per-operation range on the overlay — is what the ramp has
 * to span: scored against the per-operation range a block outruns the slowest
 * single op and every block clamped to 1, and when the member rows all shared a
 * duration `minNs === maxNs` forced every block to 0. #1944
 */
const spanOfTotals = (
    nsByNodeId: Map<string, number>,
    fallback: { minNs: number; maxNs: number },
): { minNs: number; maxNs: number } => {
    if (nsByNodeId.size === 0) {
        return fallback;
    }
    let minNs = Infinity;
    let maxNs = -Infinity;
    for (const ns of nsByNodeId.values()) {
        if (ns < minNs) {
            minNs = ns;
        }
        if (ns > maxNs) {
            maxNs = ns;
        }
    }
    return { minNs, maxNs };
};

/**
 * Position on the log ramp, matching `scoreOps`. One distinct duration across the
 * graph carries no ranking signal, so nothing is heated rather than everything.
 */
const logScore = (ns: number, minNs: number, maxNs: number): number => {
    if (minNs === maxNs) {
        return 0;
    }
    const logMin = Math.log10(minNs);
    return Math.min(1, Math.max(0, (Math.log10(ns) - logMin) / (Math.log10(maxNs) - logMin)));
};

export interface RenderedPerfStyling {
    styleByNodeId: Map<string, CSSProperties>;
    /**
     * The range the node bars are actually drawn against, which the legend is the
     * key for. Returned alongside the styles because both come from one pass over
     * the node set — they were two, from two memos with the same dependencies.
     */
    minNs: number;
    maxNs: number;
}

/**
 * Style patch by node id, or `null` when the overlay is off so the caller can
 * skip the styling pass. Custom properties only: `className` already carries
 * selection and the I/O highlight, and the filter dim is inherited.
 */
export const buildRenderedPerfStyling = (
    overlay: OpGraphPerfOverlay,
    isActive: boolean,
    nodes: readonly RenderedPerfNode[],
): RenderedPerfStyling | null => {
    if (!isActive) {
        return null;
    }

    const nsByNodeId = sumNsByRenderedNode(overlay, nodes);
    const { minNs, maxNs } = spanOfTotals(nsByNodeId, { minNs: overlay.minNs, maxNs: overlay.maxNs });

    const styleByNodeId = new Map<string, CSSProperties>();
    for (const [nodeId, ns] of nsByNodeId) {
        const t = logScore(ns, minNs, maxNs);
        styleByNodeId.set(nodeId, {
            [PERF_BAR_SCALE_VAR]: t,
            [PERF_BAR_COLOR_VAR]: perfColorScale(t),
        } as CSSProperties);
    }
    return { styleByNodeId, minNs, maxNs };
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
