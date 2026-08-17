// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { CSSProperties } from 'react';
import { describe, expect, it } from 'vitest';

import {
    NO_PERF_DATA_LABEL,
    PERF_BAR_COLOR_VAR,
    PERF_BAR_SCALE_VAR,
    buildOpGraphPerfOverlay,
    buildPerfNodeStyleByNodeId,
    getPerfHoverLabel,
} from '../src/components/operation-graph/opGraphPerfOverlay';
import { PerfOverlayStatus } from '../src/definitions/PerfOverlayStatus';
import { formatDuration } from '../src/functions/formatting';
import { type PerfOverlaySource, perfColorScale } from '../src/functions/perfOverlay';

// `device_time` is microseconds on the wire; the aggregator converts to ns.
const rows = (...pairs: [id: number, deviceTimeUs: number][]): PerfOverlaySource[] =>
    pairs.map(([id, deviceTimeUs]) => ({ id, device_time: deviceTimeUs }));

describe('buildOpGraphPerfOverlay status', () => {
    it('is unavailable when no perf report is loaded', () => {
        const overlay = buildOpGraphPerfOverlay(undefined, false, [1, 2, 3]);

        expect(overlay.status).toBe(PerfOverlayStatus.UNAVAILABLE);
        expect(overlay.linkedOpCount).toBe(0);
        // The denominator is known even with nothing to put over it, so the
        // toolbar never has to special-case which half of the pair it has.
        expect(overlay.totalOpCount).toBe(3);
    });

    it('is unavailable rather than unlinked when rows arrive without a loaded report', () => {
        // `GraphView` derives the two independently; a stale row set must not
        // upgrade the status past what the loaded report supports.
        const overlay = buildOpGraphPerfOverlay(rows([1, 10]), false, [1]);

        expect(overlay.status).toBe(PerfOverlayStatus.UNAVAILABLE);
    });

    it('is unlinked when a report is loaded but matched nothing', () => {
        const overlay = buildOpGraphPerfOverlay(undefined, true, [1, 2]);

        expect(overlay.status).toBe(PerfOverlayStatus.UNLINKED);
        expect(overlay.linkedOpCount).toBe(0);
    });

    it('is unlinked when every row belongs to an op this graph does not show', () => {
        // The failure mode a plain "are there rows?" check misses: a perf report
        // from a different run parses fine and matches no node on the canvas.
        const overlay = buildOpGraphPerfOverlay(rows([900, 10], [901, 20]), true, [1, 2]);

        expect(overlay.status).toBe(PerfOverlayStatus.UNLINKED);
    });

    it('is ready on a partial match', () => {
        const overlay = buildOpGraphPerfOverlay(rows([1, 10], [900, 20]), true, [1, 2]);

        expect(overlay.status).toBe(PerfOverlayStatus.READY);
        expect(overlay.linkedOpCount).toBe(1);
        expect(overlay.totalOpCount).toBe(2);
    });
});

describe('buildOpGraphPerfOverlay scope', () => {
    it('anchors the ramp to the ops on the canvas, not the whole report', () => {
        // An operation-range selection or hidden deallocates would otherwise
        // leave the scale pinned to a maximum the user cannot see, flattening
        // every visible node into the cool end.
        const overlay = buildOpGraphPerfOverlay(rows([1, 10], [2, 100], [3, 100_000]), true, [1, 2]);

        expect(overlay.maxNs).toBe(100 * 1_000);
        expect(overlay.scoreByOpId.has(3)).toBe(false);
        // The visible slowest op tops out the ramp rather than sitting mid-scale.
        expect(overlay.scoreByOpId.get(2)?.t).toBe(1);
    });

    it('leaves an op with no perf row unscored so it can render without a bar', () => {
        const overlay = buildOpGraphPerfOverlay(rows([1, 10], [3, 30]), true, [1, 2, 3]);

        expect(overlay.scoreByOpId.has(2)).toBe(false);
        expect(overlay.aggregatesByOpId.has(2)).toBe(false);
    });

    it('ignores rows the aggregator cannot place on a log ramp', () => {
        const overlay = buildOpGraphPerfOverlay(
            [
                { id: 1, device_time: 10 },
                { id: 2, device_time: 0 },
                { id: 3, device_time: null },
                { id: null, device_time: 50 },
            ],
            true,
            [1, 2, 3],
        );

        expect(overlay.linkedOpCount).toBe(1);
        expect(overlay.scoreByOpId.has(2)).toBe(false);
    });
});

describe('buildOpGraphPerfOverlay ranking', () => {
    it('ranks the slowest op first', () => {
        const overlay = buildOpGraphPerfOverlay(rows([1, 10], [2, 1_000], [3, 100]), true, [1, 2, 3]);

        expect(overlay.rankByOpId.get(2)).toBe(1);
        expect(overlay.rankByOpId.get(3)).toBe(2);
        expect(overlay.rankByOpId.get(1)).toBe(3);
    });

    it('ranks against the linked ops, so the hover reads "#N of linked"', () => {
        const overlay = buildOpGraphPerfOverlay(rows([1, 10], [2, 20]), true, [1, 2, 3, 4]);

        expect(overlay.linkedOpCount).toBe(2);
        expect(Math.max(...overlay.rankByOpId.values())).toBe(overlay.linkedOpCount);
    });

    it('totals only the linked ops, so per-op shares sum to 100%', () => {
        const overlay = buildOpGraphPerfOverlay(rows([1, 10], [2, 30], [900, 1_000]), true, [1, 2]);

        expect(overlay.totalNs).toBe(40 * 1_000);
        const shares = Array.from(overlay.aggregatesByOpId.values()).map(
            (aggregate) => (aggregate.deviceTimeNs / overlay.totalNs) * 100,
        );
        expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(100);
    });

    it('takes the worst case when one op contributes several rows', () => {
        const overlay = buildOpGraphPerfOverlay(rows([1, 10], [1, 90], [2, 50]), true, [1, 2]);

        expect(overlay.aggregatesByOpId.get(1)?.deviceTimeNs).toBe(90 * 1_000);
        expect(overlay.rankByOpId.get(1)).toBe(1);
    });
});

describe('buildPerfNodeStyleByNodeId', () => {
    const overlay = buildOpGraphPerfOverlay(rows([1, 10], [2, 1_000]), true, [1, 2, 3]);

    // `CSSProperties` has no index signature for custom properties, which is the
    // same reason the builder casts on the way out.
    const customProps = (style: CSSProperties | undefined): Record<string, unknown> =>
        (style ?? {}) as Record<string, unknown>;

    it('produces nothing at all when the overlay is off', () => {
        // `null` rather than an empty map, so the styling pass can return the
        // node array by identity instead of rebuilding it.
        expect(buildPerfNodeStyleByNodeId(overlay, false)).toBeNull();
    });

    it('writes only the two custom properties, leaving fill and border alone', () => {
        // Node background encodes the input/output highlight, the border and
        // box-shadow encode selection, and `className` carries both. Perf has to
        // compose with all of them rather than displace any, so the patch must
        // not reach for a single standard property. #1880
        const style = buildPerfNodeStyleByNodeId(overlay, true)?.get('2');

        expect(Object.keys(style ?? {})).toEqual([PERF_BAR_SCALE_VAR, PERF_BAR_COLOR_VAR]);
    });

    it('keys by node id so the styling pass can look up without a conversion', () => {
        const styleByNodeId = buildPerfNodeStyleByNodeId(overlay, true);

        expect(styleByNodeId?.has('1')).toBe(true);
        expect(styleByNodeId?.has('2')).toBe(true);
    });

    it('skips an op with no perf row, leaving its bar transparent', () => {
        // Op 3 is on the canvas but absent from the report. No custom property
        // means the CSS fallback paints nothing, which is what separates it from
        // the fastest op.
        expect(buildPerfNodeStyleByNodeId(overlay, true)?.has('3')).toBe(false);
    });

    it('puts the slowest visible op at the hot end of the ramp', () => {
        const styleByNodeId = buildPerfNodeStyleByNodeId(overlay, true);

        expect(customProps(styleByNodeId?.get('2'))[PERF_BAR_SCALE_VAR]).toBe(1);
        expect(customProps(styleByNodeId?.get('1'))[PERF_BAR_SCALE_VAR]).toBe(0);
    });

    it('colours the bar with the same ramp the side panel swatch uses', () => {
        // The panel derives its swatch from `perfColorScale(score.t)` too, so a
        // divergence here would show up as a node and its own detail panel
        // disagreeing about how hot the op is.
        const styleByNodeId = buildPerfNodeStyleByNodeId(overlay, true);

        expect(customProps(styleByNodeId?.get('2'))[PERF_BAR_COLOR_VAR]).toBe(perfColorScale(1));
    });
});

describe('getPerfHoverLabel', () => {
    it('gives the duration, the rank and the share of total', () => {
        const overlay = buildOpGraphPerfOverlay(rows([1, 30], [2, 10]), true, [1, 2]);

        expect(getPerfHoverLabel(overlay, 1)).toBe(`${formatDuration(30_000)} · #1 of 2 · 75.0% of total`);
    });

    it('says so plainly when the op carries no perf row', () => {
        const overlay = buildOpGraphPerfOverlay(rows([1, 30]), true, [1, 2]);

        expect(getPerfHoverLabel(overlay, 2)).toBe(NO_PERF_DATA_LABEL);
    });

    it('ranks against the linked ops, not every op on the canvas', () => {
        // Saying "#1 of 40" when only two ops have perf data would overstate
        // what the report actually covers.
        const overlay = buildOpGraphPerfOverlay(rows([1, 30], [2, 10]), true, [1, 2, 3, 4]);

        expect(getPerfHoverLabel(overlay, 1)).toContain('#1 of 2');
    });

    it('reports a whole-budget op as the whole budget', () => {
        const overlay = buildOpGraphPerfOverlay(rows([1, 30]), true, [1]);

        expect(getPerfHoverLabel(overlay, 1)).toContain('100.0% of total');
    });
});
