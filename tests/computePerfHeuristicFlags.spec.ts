// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { BoundType } from '../src/definitions/PerfTable';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { PerfHeuristicFlag } from '../src/definitions/PerfHeuristics';
import { OpType } from '../src/definitions/Performance';
import { annotatePerfHeuristicFlags } from '../src/functions/computePerfHeuristicFlags';
import { DEFAULT_MAX_CORES } from '../src/functions/getCoreCount';

const MAX_CORES = DEFAULT_MAX_CORES;

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

const getFlags = (overrides: Partial<TypedPerfTableRow> = {}, maxCores = MAX_CORES): PerfHeuristicFlag[] =>
    annotatePerfHeuristicFlags([makeRow(overrides)], maxCores)[0].heuristicFlags ?? [];

describe('annotatePerfHeuristicFlags', () => {
    it('flags DRAM-bound when bound is DRAM', () => {
        expect(getFlags({ bound: BoundType.DRAM })).toContain(PerfHeuristicFlag.DRAM_BOUND);
    });

    it('flags DRAM-bound for SLOW ops when DRAM percent dominates FLOPS percent', () => {
        expect(getFlags({ bound: BoundType.SLOW, dram_percent: 80, flops_percent: 20 })).toContain(
            PerfHeuristicFlag.DRAM_BOUND,
        );
    });

    it('does not flag DRAM-bound for BoundType.BOTH', () => {
        expect(getFlags({ bound: BoundType.BOTH, dram_percent: 90 })).not.toContain(PerfHeuristicFlag.DRAM_BOUND);
    });

    it('does not flag DRAM-bound below MIN_TOTAL_PERCENT', () => {
        expect(getFlags({ bound: BoundType.DRAM, total_percent: 0.1 })).not.toContain(PerfHeuristicFlag.DRAM_BOUND);
    });

    it('flags low utilisation when pm_ideal_ns is valid and utilisation is below threshold', () => {
        expect(
            getFlags({
                pm_ideal_ns: 1000,
                device_time: 1000,
                cores: 64,
            }),
        ).toContain(PerfHeuristicFlag.LOW_UTILISATION);
    });

    it('does not flag low utilisation when pm_ideal_ns is absent', () => {
        expect(
            getFlags({
                pm_ideal_ns: null,
                device_time: 1000,
                cores: 8,
            }),
        ).not.toContain(PerfHeuristicFlag.LOW_UTILISATION);
    });

    it('flags underutilised cores when core count is well below device max', () => {
        expect(getFlags({ cores: 8 })).toContain(PerfHeuristicFlag.UNDERUTILISED_CORES);
    });

    it('does not flag underutilised cores when enough cores are used', () => {
        expect(getFlags({ cores: 32 })).not.toContain(PerfHeuristicFlag.UNDERUTILISED_CORES);
    });

    it('flags recompute candidate on repeat hash with cache miss', () => {
        expect(
            getFlags({
                hash: 'abc123',
                isFirstHashOccurrence: false,
                cache_hit: false,
            }),
        ).toContain(PerfHeuristicFlag.RECOMPUTE_CANDIDATE);
    });

    it('does not flag recompute on first hash occurrence', () => {
        expect(
            getFlags({
                hash: 'abc123',
                isFirstHashOccurrence: true,
                cache_hit: false,
            }),
        ).not.toContain(PerfHeuristicFlag.RECOMPUTE_CANDIDATE);
    });

    it('does not flag recompute when cache hit is true', () => {
        expect(
            getFlags({
                hash: 'abc123',
                isFirstHashOccurrence: false,
                cache_hit: true,
            }),
        ).not.toContain(PerfHeuristicFlag.RECOMPUTE_CANDIDATE);
    });

    it('returns no flags for host ops', () => {
        expect(getFlags({ bound: BoundType.HOST, cores: 1, total_percent: 10 })).toEqual([]);
    });

    it('returns no flags for signposts', () => {
        expect(getFlags({ op_type: OpType.SIGNPOST })).toEqual([]);
    });

    it('can flag both low utilisation and underutilised cores on the same row', () => {
        const flags = getFlags({
            pm_ideal_ns: 1000,
            device_time: 1000,
            cores: 8,
        });

        expect(flags).toContain(PerfHeuristicFlag.LOW_UTILISATION);
        expect(flags).toContain(PerfHeuristicFlag.UNDERUTILISED_CORES);
    });

    it('returns no flags for missing rows', () => {
        expect(getFlags({ missing: true, bound: BoundType.DRAM })).toEqual([]);
    });

    it('does not flag DRAM-bound for SLOW ops when FLOPS percent dominates', () => {
        expect(getFlags({ bound: BoundType.SLOW, dram_percent: 20, flops_percent: 80 })).not.toContain(
            PerfHeuristicFlag.DRAM_BOUND,
        );
    });

    it('does not flag recompute when hash is null', () => {
        expect(getFlags({ hash: null, isFirstHashOccurrence: false, cache_hit: false })).not.toContain(
            PerfHeuristicFlag.RECOMPUTE_CANDIDATE,
        );
    });

    it('returns new row objects with heuristicFlags and tooltip details', () => {
        const row = makeRow({ bound: BoundType.DRAM });
        const [annotated] = annotatePerfHeuristicFlags([row], MAX_CORES);

        expect(annotated).not.toBe(row);
        expect(annotated.heuristicFlags).toEqual([PerfHeuristicFlag.DRAM_BOUND]);
        expect(annotated.heuristicFlagDetails?.[PerfHeuristicFlag.DRAM_BOUND]).toBe('Bound: DRAM');
        expect(row.heuristicFlags).toBeUndefined();
    });

    it('annotates multi-flag rows with every detail key', () => {
        const row = makeRow({
            bound: BoundType.DRAM,
            pm_ideal_ns: 1000,
            device_time: 1000,
            cores: 8,
        });
        const [annotated] = annotatePerfHeuristicFlags([row], MAX_CORES);

        expect(annotated.heuristicFlags).toEqual([
            PerfHeuristicFlag.DRAM_BOUND,
            PerfHeuristicFlag.LOW_UTILISATION,
            PerfHeuristicFlag.UNDERUTILISED_CORES,
        ]);
        expect(annotated.heuristicFlagDetails?.[PerfHeuristicFlag.DRAM_BOUND]).toBe('Bound: DRAM');
        expect(annotated.heuristicFlagDetails?.[PerfHeuristicFlag.LOW_UTILISATION]).toMatch(/Core utilisation:/);
        expect(annotated.heuristicFlagDetails?.[PerfHeuristicFlag.UNDERUTILISED_CORES]).toBe('Cores: 8 / 64');
    });

    it('clears heuristicFlagDetails when a row has no flags', () => {
        const row = makeRow({
            bound: BoundType.DRAM,
            total_percent: 0.1,
            heuristicFlagDetails: { [PerfHeuristicFlag.DRAM_BOUND]: 'stale' },
        });
        const [annotated] = annotatePerfHeuristicFlags([row], MAX_CORES);

        expect(annotated.heuristicFlags).toEqual([]);
        expect(annotated.heuristicFlagDetails).toBeUndefined();
    });

    it('does not flag low utilisation or underutilised cores below MIN_TOTAL_PERCENT', () => {
        const flags = getFlags({
            total_percent: 0.1,
            pm_ideal_ns: 1000,
            device_time: 1000,
            cores: 8,
        });

        expect(flags).not.toContain(PerfHeuristicFlag.LOW_UTILISATION);
        expect(flags).not.toContain(PerfHeuristicFlag.UNDERUTILISED_CORES);
    });

    it('uses the supplied maxCores for underutilised-cores thresholds', () => {
        // 20/64 ≈ 0.31 is above the underutilised ratio; 20/130 ≈ 0.15 is below.
        expect(getFlags({ cores: 20 }, 64)).not.toContain(PerfHeuristicFlag.UNDERUTILISED_CORES);
        expect(getFlags({ cores: 20 }, 130)).toContain(PerfHeuristicFlag.UNDERUTILISED_CORES);
    });

    it('stores DRAM vs FLOPS detail for SLOW DRAM-bound rows', () => {
        const [annotated] = annotatePerfHeuristicFlags(
            [makeRow({ bound: BoundType.SLOW, dram_percent: 80, flops_percent: 20 })],
            MAX_CORES,
        );

        expect(annotated.heuristicFlagDetails?.[PerfHeuristicFlag.DRAM_BOUND]).toBe('DRAM 80% vs FLOPS 20%');
    });

    it('stores hash detail for recompute candidates', () => {
        const [annotated] = annotatePerfHeuristicFlags(
            [makeRow({ hash: 'abc123', isFirstHashOccurrence: false, cache_hit: false })],
            MAX_CORES,
        );

        expect(annotated.heuristicFlagDetails?.[PerfHeuristicFlag.RECOMPUTE_CANDIDATE]).toBe('Hash: abc123');
    });
});
