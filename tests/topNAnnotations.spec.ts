// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    RankedAnnotation,
    TOP_N_MODE_LABEL,
    TopNAnnotationMode,
    selectTopNAnnotations,
} from '../src/functions/topNAnnotations';
import { OpPerfAggregate } from '../src/functions/perfOverlay';
import { L1PressureMetrics } from '../src/functions/l1Pressure';

const op = (id: number) => ({ id });

interface PerfAggregateOptions {
    rowCount?: number;
    opToOpGapNs?: number | null;
    dramPercent?: number | null;
    flopsPercent?: number | null;
}

const perfAggregate = (opId: number, deviceTimeNs: number, options: PerfAggregateOptions = {}): OpPerfAggregate => ({
    opId,
    deviceTimeNs,
    rowCount: options.rowCount ?? 1,
    opToOpGapNs: options.opToOpGapNs ?? null,
    dramPercent: options.dramPercent ?? null,
    flopsPercent: options.flopsPercent ?? null,
});

const l1Metrics = (fullnessPercent: number): L1PressureMetrics => ({
    fullnessPercent,
    freeSegments: 0,
    largestFreeBytes: 0,
    largestFreePercent: 0,
});

describe('selectTopNAnnotations', () => {
    describe('PERF_TIME mode', () => {
        it('returns an empty map when no perf aggregates are provided', () => {
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 5,
                operations: [op(1), op(2), op(3)],
            });
            expect(result.size).toBe(0);
        });

        it('returns an empty map when perf aggregates are empty', () => {
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 5,
                operations: [op(1), op(2)],
                perfAggregatesByOpId: new Map(),
            });
            expect(result.size).toBe(0);
        });

        it('ranks ops by device time descending and assigns row indices from the operations array', () => {
            const operations = [op(1), op(2), op(3), op(4)];
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 100)],
                [2, perfAggregate(2, 9000)],
                [3, perfAggregate(3, 500)],
                [4, perfAggregate(4, 2000)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 3,
                operations,
                perfAggregatesByOpId: aggregates,
            });

            const ranked = [...result.values()].sort((a: RankedAnnotation, b: RankedAnnotation) => a.rank - b.rank);
            expect(ranked.map((r) => r.opId)).toEqual([2, 4, 3]);
            expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
            // rowIndex must reflect position in the rendered list — op 2 is at index 1, op 4 at 3, op 3 at 2.
            expect(ranked.map((r) => r.rowIndex)).toEqual([1, 3, 2]);
        });

        it('breaks ties on opId ascending for deterministic ordering', () => {
            const operations = [op(7), op(5), op(9)];
            const aggregates = new Map<number, OpPerfAggregate>([
                [5, perfAggregate(5, 1000)],
                [7, perfAggregate(7, 1000)],
                [9, perfAggregate(9, 1000)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 2,
                operations,
                perfAggregatesByOpId: aggregates,
            });

            const ranked = [...result.values()].sort((a, b) => a.rank - b.rank);
            expect(ranked.map((r) => r.opId)).toEqual([5, 7]);
        });

        it('only annotates ops present in the rendered operations slice (DRAM zoom case)', () => {
            // Full report has ops 1..5, but the renderer is only showing a zoomed segment (ops 3 and 4).
            // The fastest op overall is op 5 — but it's offscreen, so it must not be annotated.
            const renderedSlice = [op(3), op(4)];
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 50)],
                [2, perfAggregate(2, 200)],
                [3, perfAggregate(3, 1000)],
                [4, perfAggregate(4, 500)],
                [5, perfAggregate(5, 100_000)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 5,
                operations: renderedSlice,
                perfAggregatesByOpId: aggregates,
            });

            expect([...result.keys()].sort()).toEqual([3, 4]);
            expect(result.get(3)?.rank).toBe(1);
            expect(result.get(4)?.rank).toBe(2);
        });

        it('emits 0..1 normalised t spanning the top-N slice on a log scale', () => {
            const operations = [op(1), op(2), op(3)];
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 10)],
                [2, perfAggregate(2, 100)],
                [3, perfAggregate(3, 1000)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 3,
                operations,
                perfAggregatesByOpId: aggregates,
            });
            // log10(10)=1, log10(100)=2, log10(1000)=3 — slowest gets t=1, fastest t=0, middle t=0.5.
            expect(result.get(3)?.t).toBeCloseTo(1, 5);
            expect(result.get(2)?.t).toBeCloseTo(0.5, 5);
            expect(result.get(1)?.t).toBeCloseTo(0, 5);
        });

        it('emits t=0 for every annotation when all values are equal', () => {
            const operations = [op(1), op(2)];
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 500)],
                [2, perfAggregate(2, 500)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 5,
                operations,
                perfAggregatesByOpId: aggregates,
            });
            expect([...result.values()].every((r) => r.t === 0)).toBe(true);
        });

        it('skips non-finite or non-positive perf values', () => {
            const operations = [op(1), op(2), op(3), op(4)];
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 100)],
                [2, perfAggregate(2, 0)],
                [3, perfAggregate(3, Number.NaN)],
                [4, perfAggregate(4, 200)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 5,
                operations,
                perfAggregatesByOpId: aggregates,
            });
            expect([...result.keys()].sort()).toEqual([1, 4]);
        });

        it('formats the value label with formatDuration (µs / ms etc)', () => {
            const operations = [op(1)];
            const aggregates = new Map<number, OpPerfAggregate>([[1, perfAggregate(1, 1_500_000)]]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 1,
                operations,
                perfAggregatesByOpId: aggregates,
            });
            // 1.5 ms — formatDuration falls into the millisecond branch.
            expect(result.get(1)?.valueLabel).toMatch(/ms$/);
        });
    });

    describe('PERF_OP_TO_OP_GAP mode', () => {
        it('ranks ops by op-to-op gap (ns), skipping ops without a gap value', () => {
            const operations = [op(1), op(2), op(3), op(4)];
            // Mix of contributing and non-contributing rows — op 3 has no gap, op 4 has zero.
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 100, { opToOpGapNs: 4_000 })],
                [2, perfAggregate(2, 100, { opToOpGapNs: 50_000 })],
                [3, perfAggregate(3, 100)],
                [4, perfAggregate(4, 100, { opToOpGapNs: 0 })],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_OP_TO_OP_GAP,
                n: 5,
                operations,
                perfAggregatesByOpId: aggregates,
            });
            expect([...result.keys()].sort()).toEqual([1, 2]);
            expect(result.get(2)?.rank).toBe(1);
            expect(result.get(1)?.rank).toBe(2);
            // Long-tail metric — same log-scale path as PERF_TIME.
            expect(result.get(2)?.t).toBeCloseTo(1, 5);
        });

        it('formats the value label with formatDuration', () => {
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 100, { opToOpGapNs: 1_500_000 })],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_OP_TO_OP_GAP,
                n: 1,
                operations: [op(1)],
                perfAggregatesByOpId: aggregates,
            });
            expect(result.get(1)?.valueLabel).toMatch(/ms$/);
        });
    });

    describe('PERF_DRAM_PERCENT mode', () => {
        it('ranks ops by DRAM utilisation (linear normalisation, percent label)', () => {
            const operations = [op(1), op(2), op(3)];
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 100, { dramPercent: 25 })],
                [2, perfAggregate(2, 100, { dramPercent: 75 })],
                [3, perfAggregate(3, 100, { dramPercent: 50 })],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_DRAM_PERCENT,
                n: 3,
                operations,
                perfAggregatesByOpId: aggregates,
            });
            const ranked = [...result.values()].sort((a, b) => a.rank - b.rank);
            expect(ranked.map((r) => r.opId)).toEqual([2, 3, 1]);
            // Linear over the top-N slice [25, 75]: 75→1, 50→0.5, 25→0.
            expect(result.get(2)?.t).toBeCloseTo(1, 5);
            expect(result.get(3)?.t).toBeCloseTo(0.5, 5);
            expect(result.get(1)?.t).toBeCloseTo(0, 5);
            expect(result.get(2)?.valueLabel).toBe('75.0%');
        });

        it('skips ops with no DRAM data', () => {
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 100, { dramPercent: 40 })],
                [2, perfAggregate(2, 100)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_DRAM_PERCENT,
                n: 5,
                operations: [op(1), op(2)],
                perfAggregatesByOpId: aggregates,
            });
            expect([...result.keys()]).toEqual([1]);
        });
    });

    describe('PERF_FLOPS_PERCENT mode', () => {
        it('ranks ops by FLOPS utilisation with percent labels', () => {
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 100, { flopsPercent: 10 })],
                [2, perfAggregate(2, 100, { flopsPercent: 90 })],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_FLOPS_PERCENT,
                n: 2,
                operations: [op(1), op(2)],
                perfAggregatesByOpId: aggregates,
            });
            expect(result.get(2)?.rank).toBe(1);
            expect(result.get(1)?.rank).toBe(2);
            expect(result.get(2)?.valueLabel).toBe('90.0%');
        });
    });

    describe('L1_FULLNESS mode', () => {
        it('returns an empty map when no L1 pressure map is provided', () => {
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.L1_FULLNESS,
                n: 5,
                operations: [op(1)],
            });
            expect(result.size).toBe(0);
        });

        it('ranks ops by fullnessPercent descending', () => {
            const operations = [op(1), op(2), op(3)];
            const pressure = new Map<number, L1PressureMetrics>([
                [1, l1Metrics(20)],
                [2, l1Metrics(80)],
                [3, l1Metrics(40)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.L1_FULLNESS,
                n: 2,
                operations,
                l1PressureByOpId: pressure,
            });

            const ranked = [...result.values()].sort((a, b) => a.rank - b.rank);
            expect(ranked.map((r) => r.opId)).toEqual([2, 3]);
            expect(ranked.map((r) => r.rawValue)).toEqual([80, 40]);
        });

        it('uses linear normalisation in [0, 1] across the top-N slice', () => {
            const operations = [op(1), op(2), op(3)];
            const pressure = new Map<number, L1PressureMetrics>([
                [1, l1Metrics(20)],
                [2, l1Metrics(60)],
                [3, l1Metrics(100)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.L1_FULLNESS,
                n: 3,
                operations,
                l1PressureByOpId: pressure,
            });
            expect(result.get(3)?.t).toBeCloseTo(1, 5);
            expect(result.get(2)?.t).toBeCloseTo(0.5, 5);
            expect(result.get(1)?.t).toBeCloseTo(0, 5);
        });

        it('skips ops with non-positive or non-finite fullness', () => {
            const operations = [op(1), op(2), op(3)];
            const pressure = new Map<number, L1PressureMetrics>([
                [1, l1Metrics(50)],
                [2, l1Metrics(0)],
                [3, l1Metrics(Number.NaN)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.L1_FULLNESS,
                n: 5,
                operations,
                l1PressureByOpId: pressure,
            });
            expect([...result.keys()]).toEqual([1]);
        });

        it('formats the value label as a percentage', () => {
            const operations = [op(1)];
            const pressure = new Map<number, L1PressureMetrics>([[1, l1Metrics(73.456)]]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.L1_FULLNESS,
                n: 1,
                operations,
                l1PressureByOpId: pressure,
            });
            expect(result.get(1)?.valueLabel).toBe('73.5%');
        });
    });

    describe('edge cases', () => {
        it('returns an empty map when n is zero', () => {
            const operations = [op(1)];
            const aggregates = new Map<number, OpPerfAggregate>([[1, perfAggregate(1, 100)]]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 0,
                operations,
                perfAggregatesByOpId: aggregates,
            });
            expect(result.size).toBe(0);
        });

        it('returns an empty map when n is negative', () => {
            const operations = [op(1)];
            const aggregates = new Map<number, OpPerfAggregate>([[1, perfAggregate(1, 100)]]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: -3,
                operations,
                perfAggregatesByOpId: aggregates,
            });
            expect(result.size).toBe(0);
        });

        it('returns an empty map when the operations array is empty', () => {
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 5,
                operations: [],
                perfAggregatesByOpId: new Map([[1, perfAggregate(1, 100)]]),
            });
            expect(result.size).toBe(0);
        });

        it('clamps to operations.length when n exceeds the candidate count', () => {
            const operations = [op(1), op(2)];
            const aggregates = new Map<number, OpPerfAggregate>([
                [1, perfAggregate(1, 100)],
                [2, perfAggregate(2, 200)],
            ]);
            const result = selectTopNAnnotations({
                mode: TopNAnnotationMode.PERF_TIME,
                n: 50,
                operations,
                perfAggregatesByOpId: aggregates,
            });
            expect(result.size).toBe(2);
        });
    });

    describe('TOP_N_MODE_LABEL', () => {
        it('has a non-empty human label for every mode in the enum', () => {
            for (const mode of Object.values(TopNAnnotationMode)) {
                expect(TOP_N_MODE_LABEL[mode], `missing label for mode ${mode}`).toBeTruthy();
            }
        });
    });
});
