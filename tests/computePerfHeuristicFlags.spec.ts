// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { BoundType, TypedPerfTableRow } from '../src/definitions/PerfTable';
import { PerfHeuristicFlag } from '../src/definitions/PerfHeuristics';
import { OpType } from '../src/definitions/Performance';
import { computePerfHeuristicFlags } from '../src/functions/computePerfHeuristicFlags';

const MAX_CORES = 64;

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
});
