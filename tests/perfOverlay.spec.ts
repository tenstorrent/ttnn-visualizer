// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { aggregatePerfByOp, perfColorScale, scoreOps } from '../src/functions/perfOverlay';
import { PERF_BINS } from '../src/definitions/GraphColors';
import { TypedPerfTableRow } from '../src/definitions/PerfTable';

/* eslint-disable camelcase -- `device_time` matches the API wire shape (snake_case) */
const row = (id: number | null, device_time: number | null): TypedPerfTableRow =>
    ({ id, device_time }) as unknown as TypedPerfTableRow;
/* eslint-enable camelcase */

describe('aggregatePerfByOp', () => {
    it('returns an empty map for empty input', () => {
        expect(aggregatePerfByOp([]).size).toBe(0);
    });

    it('skips rows with null id', () => {
        const map = aggregatePerfByOp([row(null, 1000), row(1, 1000)]);
        expect(map.size).toBe(1);
        expect(map.has(1)).toBe(true);
    });

    it('skips rows with null, zero, negative, or non-finite device_time', () => {
        const map = aggregatePerfByOp([
            row(1, null),
            row(2, 0),
            row(3, -100),
            row(4, Number.NaN),
            row(5, Number.POSITIVE_INFINITY),
            row(6, 500),
        ]);
        expect(Array.from(map.keys())).toEqual([6]);
    });

    it('takes the max device_time across multiple rows per op id and converts µs → ns', () => {
        // Wire `device_time` is microseconds; aggregator normalises to ns.
        const map = aggregatePerfByOp([row(7, 1000), row(7, 4000), row(7, 2000)]);
        const agg = map.get(7);
        expect(agg).toBeDefined();
        expect(agg?.deviceTimeNs).toBe(4_000_000);
        expect(agg?.rowCount).toBe(3);
    });
});

describe('scoreOps', () => {
    it('returns empty scores for empty aggregates', () => {
        const result = scoreOps(new Map());
        expect(result.scoreByOpId.size).toBe(0);
        expect(result.minNs).toBe(0);
        expect(result.maxNs).toBe(0);
    });

    it('assigns t=0 and sizeBin=0 to every op when all device times are equal', () => {
        // Inputs are µs (100 µs); aggregator stores ns (100_000 ns).
        const map = aggregatePerfByOp([row(1, 100), row(2, 100), row(3, 100)]);
        const { scoreByOpId, minNs, maxNs } = scoreOps(map);
        for (const id of [1, 2, 3]) {
            const score = scoreByOpId.get(id);
            expect(score?.t).toBe(0);
            expect(score?.sizeBin).toBe(0);
        }
        expect(minNs).toBe(100_000);
        expect(maxNs).toBe(100_000);
    });

    it('puts the min at t=0 / sizeBin=0 and the max at t=1 / top sizeBin', () => {
        const map = aggregatePerfByOp([row(1, 10), row(2, 100_000)]);
        const { scoreByOpId } = scoreOps(map);
        expect(scoreByOpId.get(1)?.t).toBe(0);
        expect(scoreByOpId.get(1)?.sizeBin).toBe(0);
        expect(scoreByOpId.get(2)?.t).toBe(1);
        expect(scoreByOpId.get(2)?.sizeBin).toBe(PERF_BINS.length - 1);
    });

    it('produces monotonically non-decreasing t for monotonically increasing input', () => {
        const map = aggregatePerfByOp([row(1, 100), row(2, 1_000), row(3, 10_000), row(4, 100_000), row(5, 1_000_000)]);
        const { scoreByOpId } = scoreOps(map);
        const ts = [1, 2, 3, 4, 5].map((id) => scoreByOpId.get(id)?.t ?? -1);
        for (let i = 1; i < ts.length; i++) {
            expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1]);
        }
        expect(ts[0]).toBe(0);
        expect(ts[ts.length - 1]).toBe(1);
    });

    it('respects a custom bin count for sizing', () => {
        const map = aggregatePerfByOp([row(1, 1), row(2, 1_000_000)]);
        const { scoreByOpId } = scoreOps(map, 3);
        expect(scoreByOpId.get(1)?.sizeBin).toBe(0);
        expect(scoreByOpId.get(2)?.sizeBin).toBe(2);
    });
});

describe('perfColorScale', () => {
    it('returns the coolest stop at t=0 and hottest stop at t=1', () => {
        expect(perfColorScale(0).toLowerCase()).toBe(PERF_BINS[0].color.toLowerCase());
        expect(perfColorScale(1).toLowerCase()).toBe(PERF_BINS[PERF_BINS.length - 1].color.toLowerCase());
    });

    it('clamps out-of-range input', () => {
        expect(perfColorScale(-1).toLowerCase()).toBe(PERF_BINS[0].color.toLowerCase());
        expect(perfColorScale(2).toLowerCase()).toBe(PERF_BINS[PERF_BINS.length - 1].color.toLowerCase());
    });

    it('returns a valid hex color for interior t values', () => {
        const mid = perfColorScale(0.5);
        expect(mid).toMatch(/^#[0-9a-f]{6}$/);
        const quarter = perfColorScale(0.25);
        const threequarter = perfColorScale(0.75);
        // Different positions should produce different colours.
        expect(quarter).not.toBe(threequarter);
    });

    it('falls back to the coolest stop for non-finite input', () => {
        expect(perfColorScale(Number.NaN).toLowerCase()).toBe(PERF_BINS[0].color.toLowerCase());
        expect(perfColorScale(Number.POSITIVE_INFINITY).toLowerCase()).toBe(PERF_BINS[0].color.toLowerCase());
    });
});
