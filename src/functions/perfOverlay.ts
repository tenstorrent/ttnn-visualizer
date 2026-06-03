// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PERF_BINS } from '../definitions/GraphColors';

/**
 * Minimal projection of a perf row the overlay needs. Decoupled from the
 * full `TypedPerfTableRow` so `GraphView` can produce rows without pulling
 * the perf-table enrichment pipeline.
 *
 * `device_time` matches the wire format: **microseconds**. The overlay
 * normalises to nanoseconds at aggregation time so `formatDuration` and the
 * legend labels work in the same unit downstream. Keep the wire-format
 * semantics on this interface so future modifications can't silently mix
 * units between the projection and the rest of the perf-table pipeline
 * (see `PerfDeviceTimeChart` for the same µs → ns conversion).
 */
export interface PerfOverlaySource {
    id: number | null;
    device_time: number | null;
}

/** Conversion factor for the wire µs value to the internal ns representation. */
const US_TO_NS = 1_000;

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
            const deviceTimeNs = dt * US_TO_NS;
            const existing = aggregatesByOpId.get(id);
            if (existing === undefined) {
                aggregatesByOpId.set(id, { opId: id, deviceTimeNs, rowCount: 1 });
            } else {
                existing.deviceTimeNs = Math.max(existing.deviceTimeNs, deviceTimeNs);
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
}

export interface ScoreResult {
    scoreByOpId: Map<number, OpPerfScore>;
    minNs: number;
    maxNs: number;
}

/**
 * Score each aggregated op against the observed min/max device time using a
 * log10 scale. `t` is the continuous position used for colour interpolation.
 *
 * Real-world perf data is long-tailed (a handful of ops dominate the budget),
 * so a linear scale would crush 95% of nodes into the cool end. Log scale
 * keeps the ramp meaningful across orders of magnitude.
 *
 * Edge cases:
 * - Empty input → empty map, zero min/max.
 * - All values equal → everything gets `t=0` (no signal to rank).
 */
export const scoreOps = (aggregates: Map<number, OpPerfAggregate>): ScoreResult => {
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
            scoreByOpId.set(a.opId, { opId: a.opId, t: 0 });
        }
        return { scoreByOpId, minNs, maxNs };
    }
    const logMin = Math.log10(minNs);
    const range = Math.log10(maxNs) - logMin;
    for (const a of aggregates.values()) {
        const t = Math.min(1, Math.max(0, (Math.log10(a.deviceTimeNs) - logMin) / range));
        scoreByOpId.set(a.opId, { opId: a.opId, t });
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

/**
 * Threshold on relative luminance (0..1, ITU-R BT.601 coefficients) below
 * which the dark default node label loses contrast against the perf overlay
 * background. Tuned against `PERF_BINS`: the two cold bins (`#3b4a6b`,
 * `#3f7d8c`) and the hot-red bin (`#ff3b1f`) fall below; the yellow/orange
 * bins land above. Interpolated colours along the cold↔warm boundary flip
 * once they cross 0.5, which keeps the transition visually smooth.
 */
const DARK_BG_LUMINANCE_THRESHOLD = 0.5;

/** ITU-R BT.601 perceived-luminance weights. */
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

/**
 * `true` when the dark node label (`#202020`) loses contrast against `hex`
 * and a light label colour should be used instead. Non-parseable input is
 * treated as not-dark so we never strand a white label on whatever colour
 * the fallback rendering path ends up using.
 */
export const isDarkPerfColor = (hex: string): boolean => {
    if (!HEX_RE.test(hex)) {
        return false;
    }
    const [r, g, b] = hexToRgb(hex);
    const luminance = (LUMA_R * r + LUMA_G * g + LUMA_B * b) / 255;
    return luminance < DARK_BG_LUMINANCE_THRESHOLD;
};
