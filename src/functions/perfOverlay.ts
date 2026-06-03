// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PERF_BINS } from '../definitions/GraphColors';

/**
 * Minimal projection of a perf row the overlay needs. Decoupled from the
 * full `TypedPerfTableRow` so `GraphView` can produce rows without pulling
 * the perf-table enrichment pipeline.
 */
export interface PerfOverlaySource {
    id: number | null;
    device_time: number | null;
}

export interface OpPerfAggregate {
    opId: number;
    deviceTimeNs: number;
    rowCount: number;
}

/**
 * Collapse per-op perf rows down to a single value per `op.id`, taking the
 * max kernel duration across rows (a single graph op may appear multiple times
 * in a perf report — multi-device, repeated calls).
 *
 * Rows with a null `id`, null/non-finite `device_time`, or non-positive
 * `device_time` are skipped — they can't contribute to a log-scale ramp.
 */
export const aggregatePerfByOp = (rows: PerfOverlaySource[]): Map<number, OpPerfAggregate> => {
    const aggregatesByOpId = new Map<number, OpPerfAggregate>();
    for (const row of rows) {
        const { id } = row;
        const dt = row.device_time;
        if (id !== null && dt !== null && Number.isFinite(dt) && dt > 0) {
            const existing = aggregatesByOpId.get(id);
            if (existing === undefined) {
                aggregatesByOpId.set(id, { opId: id, deviceTimeNs: dt, rowCount: 1 });
            } else {
                existing.deviceTimeNs = Math.max(existing.deviceTimeNs, dt);
                existing.rowCount += 1;
            }
        }
    }
    return aggregatesByOpId;
};

export interface OpPerfScore {
    opId: number;
    /** Normalised log10 position in `[0, 1]` across the observed min/max. */
    t: number;
    /** Index into `PERF_BINS` for sizing (still discrete — keeps zoom-out legible). */
    sizeBin: number;
}

export interface ScoreResult {
    scoreByOpId: Map<number, OpPerfScore>;
    minNs: number;
    maxNs: number;
}

/**
 * Score each aggregated op against the observed min/max device time using a
 * log10 scale. Returns:
 *  - `t` for continuous colour interpolation,
 *  - `sizeBin` for discrete sizing (we still want a couple of size steps so
 *    hot ops remain visible when the graph is zoomed out, but the colour is
 *    smooth so neighbours in the ramp don't visually flip).
 *
 * Real-world perf data is long-tailed (a handful of ops dominate the budget),
 * so a linear scale would crush 95% of nodes into the cool end. Log scale
 * keeps the ramp meaningful across orders of magnitude.
 *
 * Edge cases:
 * - Empty input → empty map, zero min/max.
 * - All values equal → everything gets `t=0`, `sizeBin=0` (no signal to rank).
 */
export const scoreOps = (
    aggregates: Map<number, OpPerfAggregate>,
    binCount: number = PERF_BINS.length,
): ScoreResult => {
    const scoreByOpId = new Map<number, OpPerfScore>();
    if (aggregates.size === 0) {
        return { scoreByOpId, minNs: 0, maxNs: 0 };
    }
    let minNs = Infinity;
    let maxNs = -Infinity;
    for (const a of aggregates.values()) {
        if (a.deviceTimeNs < minNs) {
            minNs = a.deviceTimeNs;
        }
        if (a.deviceTimeNs > maxNs) {
            maxNs = a.deviceTimeNs;
        }
    }
    if (minNs === maxNs) {
        for (const a of aggregates.values()) {
            scoreByOpId.set(a.opId, { opId: a.opId, t: 0, sizeBin: 0 });
        }
        return { scoreByOpId, minNs, maxNs };
    }
    const logMin = Math.log10(minNs);
    const range = Math.log10(maxNs) - logMin;
    for (const a of aggregates.values()) {
        const t = Math.min(1, Math.max(0, (Math.log10(a.deviceTimeNs) - logMin) / range));
        const sizeBin = Math.min(binCount - 1, Math.max(0, Math.floor(t * binCount)));
        scoreByOpId.set(a.opId, { opId: a.opId, t, sizeBin });
    }
    return { scoreByOpId, minNs, maxNs };
};

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

const hexToRgb = (hex: string): [number, number, number] => {
    const match = HEX_RE.exec(hex);
    if (!match) {
        return [0, 0, 0];
    }
    const h = match[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

const toHex = (n: number): string => n.toString(16).padStart(2, '0');

/**
 * Interpolate the perf colour ramp at position `t` in `[0, 1]`, using
 * `PERF_BINS` as evenly-spaced colour stops. Out-of-range `t` is clamped;
 * non-finite `t` falls back to the coolest stop.
 */
export const perfColorScale = (t: number): string => {
    if (!Number.isFinite(t)) {
        return PERF_BINS[0].color;
    }
    const clamped = Math.min(1, Math.max(0, t));
    const segments = PERF_BINS.length - 1;
    const segPos = clamped * segments;
    const lo = Math.min(segments - 1, Math.floor(segPos));
    const frac = segPos - lo;
    const [r1, g1, b1] = hexToRgb(PERF_BINS[lo].color);
    const [r2, g2, b2] = hexToRgb(PERF_BINS[lo + 1].color);
    return `#${toHex(lerp(r1, r2, frac))}${toHex(lerp(g1, g2, frac))}${toHex(lerp(b1, b2, frac))}`;
};

/**
 * Pre-rendered CSS `linear-gradient(...)` value for the perf overlay legend.
 * Stops are PERF_BINS, evenly spaced left → right.
 */
export const PERF_GRADIENT_CSS = `linear-gradient(to right, ${PERF_BINS.map((b) => b.color).join(', ')})`;
