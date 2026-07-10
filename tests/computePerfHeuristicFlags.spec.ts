// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { BoundType, TypedPerfTableRow } from '../src/definitions/PerfTable';
import { PerfHeuristicFlag } from '../src/definitions/PerfHeuristics';
import { OpType } from '../src/definitions/Performance';
import {
    annotatePerfHeuristicFlags,
    buildPerfHeuristicContext,
    computePerfHeuristicFlags,
    getPerfHeuristicFlagTooltipDetail,
} from '../src/functions/computePerfHeuristicFlags';
import { DEFAULT_MAX_CORES } from '../src/functions/getCoreCount';

const MAX_CORES = DEFAULT_MAX_CORES;

const context = { maxCores: MAX_CORES };

const makeRow = (overrides: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        raw_op_code: 'Matmul',
        op_code: 'Matmul',
        total_percent: 5,
        bound: null,
        dram_percent: null,
        flops_percent: null,
        pm_ideal_ns: null,
        device_time: null,
        cores: null,
        hash: null,
        cache_hit: null,
        isFirstHashOccurrence: true,
        ...overrides,
    }) as TypedPerfTableRow;

describe('computePerfHeuristicFlags', () => {
    it('flags DRAM-bound when bound is DRAM', () => {
        const flags = computePerfHeuristicFlags(makeRow({ bound: BoundType.DRAM }), context);

        expect(flags).toContain(PerfHeuristicFlag.DRAM_BOUND);
    });

    it('flags DRAM-bound for SLOW ops when DRAM percent dominates FLOPS percent', () => {
        const flags = computePerfHeuristicFlags(
            makeRow({ bound: BoundType.SLOW, dram_percent: 80, flops_percent: 20 }),
            context,
        );

        expect(flags).toContain(PerfHeuristicFlag.DRAM_BOUND);
    });

    it('does not flag DRAM-bound for BoundType.BOTH', () => {
        const flags = computePerfHeuristicFlags(makeRow({ bound: BoundType.BOTH, dram_percent: 90 }), context);

        expect(flags).not.toContain(PerfHeuristicFlag.DRAM_BOUND);
    });

    it('does not flag DRAM-bound below MIN_TOTAL_PERCENT', () => {
        const flags = computePerfHeuristicFlags(makeRow({ bound: BoundType.DRAM, total_percent: 0.1 }), context);

        expect(flags).not.toContain(PerfHeuristicFlag.DRAM_BOUND);
    });

    it('flags low utilisation when pm_ideal_ns is valid and utilisation is below threshold', () => {
        const flags = computePerfHeuristicFlags(
            makeRow({
                pm_ideal_ns: 1000,
                device_time: 1000,
                cores: 64,
            }),
            context,
        );

        expect(flags).toContain(PerfHeuristicFlag.LOW_UTILISATION);
    });

    it('does not flag low utilisation when pm_ideal_ns is absent', () => {
        const flags = computePerfHeuristicFlags(
            makeRow({
                pm_ideal_ns: null,
                device_time: 1000,
                cores: 8,
            }),
            context,
        );

        expect(flags).not.toContain(PerfHeuristicFlag.LOW_UTILISATION);
    });

    it('flags underutilised cores when core count is well below device max', () => {
        const flags = computePerfHeuristicFlags(makeRow({ cores: 8 }), context);

        expect(flags).toContain(PerfHeuristicFlag.UNDERUTILISED_CORES);
    });

    it('does not flag underutilised cores when enough cores are used', () => {
        const flags = computePerfHeuristicFlags(makeRow({ cores: 32 }), context);

        expect(flags).not.toContain(PerfHeuristicFlag.UNDERUTILISED_CORES);
    });

    it('flags recompute candidate on repeat hash with cache miss', () => {
        const flags = computePerfHeuristicFlags(
            makeRow({
                hash: 'abc123',
                isFirstHashOccurrence: false,
                cache_hit: false,
            }),
            context,
        );

        expect(flags).toContain(PerfHeuristicFlag.RECOMPUTE_CANDIDATE);
    });

    it('does not flag recompute on first hash occurrence', () => {
        const flags = computePerfHeuristicFlags(
            makeRow({
                hash: 'abc123',
                isFirstHashOccurrence: true,
                cache_hit: false,
            }),
            context,
        );

        expect(flags).not.toContain(PerfHeuristicFlag.RECOMPUTE_CANDIDATE);
    });

    it('does not flag recompute when cache hit is true', () => {
        const flags = computePerfHeuristicFlags(
            makeRow({
                hash: 'abc123',
                isFirstHashOccurrence: false,
                cache_hit: true,
            }),
            context,
        );

        expect(flags).not.toContain(PerfHeuristicFlag.RECOMPUTE_CANDIDATE);
    });

    it('returns no flags for host ops', () => {
        const flags = computePerfHeuristicFlags(
            makeRow({ bound: BoundType.HOST, cores: 1, total_percent: 10 }),
            context,
        );

        expect(flags).toEqual([]);
    });

    it('returns no flags for signposts', () => {
        const flags = computePerfHeuristicFlags(makeRow({ op_type: OpType.SIGNPOST }), context);

        expect(flags).toEqual([]);
    });

    it('can flag both low utilisation and underutilised cores on the same row', () => {
        const flags = computePerfHeuristicFlags(
            makeRow({
                pm_ideal_ns: 1000,
                device_time: 1000,
                cores: 8,
            }),
            context,
        );

        expect(flags).toContain(PerfHeuristicFlag.LOW_UTILISATION);
        expect(flags).toContain(PerfHeuristicFlag.UNDERUTILISED_CORES);
    });

    it('returns no flags for missing rows', () => {
        const flags = computePerfHeuristicFlags(makeRow({ missing: true, bound: BoundType.DRAM }), context);

        expect(flags).toEqual([]);
    });

    it('does not flag DRAM-bound for SLOW ops when FLOPS percent dominates', () => {
        const flags = computePerfHeuristicFlags(
            makeRow({ bound: BoundType.SLOW, dram_percent: 20, flops_percent: 80 }),
            context,
        );

        expect(flags).not.toContain(PerfHeuristicFlag.DRAM_BOUND);
    });

    it('does not flag recompute when hash is null', () => {
        const flags = computePerfHeuristicFlags(
            makeRow({ hash: null, isFirstHashOccurrence: false, cache_hit: false }),
            context,
        );

        expect(flags).not.toContain(PerfHeuristicFlag.RECOMPUTE_CANDIDATE);
    });

    it('annotates rows with heuristicFlags in place', () => {
        const row = makeRow({ bound: BoundType.DRAM });
        const [annotated] = annotatePerfHeuristicFlags([row], context);

        expect(annotated).toBe(row);
        expect(annotated.heuristicFlags).toEqual([PerfHeuristicFlag.DRAM_BOUND]);
    });

    it('buildPerfHeuristicContext falls back to row-derived core count', () => {
        const contextFromRows = buildPerfHeuristicContext(null, [makeRow({ cores: 48 })]);

        expect(contextFromRows.maxCores).toBe(DEFAULT_MAX_CORES);
    });
});

describe('getPerfHeuristicFlagTooltipDetail', () => {
    it('returns DRAM vs FLOPS detail for SLOW DRAM-bound rows', () => {
        const row = makeRow({ bound: BoundType.SLOW, dram_percent: 80, flops_percent: 20 });

        expect(getPerfHeuristicFlagTooltipDetail(PerfHeuristicFlag.DRAM_BOUND, row, context)).toBe(
            'DRAM 80% vs FLOPS 20%',
        );
    });

    it('returns core utilisation detail for low utilisation flags', () => {
        const row = makeRow({ pm_ideal_ns: 1000, device_time: 1000, cores: 64 });

        expect(getPerfHeuristicFlagTooltipDetail(PerfHeuristicFlag.LOW_UTILISATION, row, context)).toMatch(
            /Core utilisation:/,
        );
    });

    it('returns cores ratio for underutilised cores', () => {
        expect(
            getPerfHeuristicFlagTooltipDetail(PerfHeuristicFlag.UNDERUTILISED_CORES, makeRow({ cores: 8 }), context),
        ).toBe('Cores: 8 / 64');
    });
});
