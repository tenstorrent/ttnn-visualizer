// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { enrichRowData } from '../src/functions/enrichPerfRowData';
import { LinkedOperationData, PerfTableRow } from '../src/model/PerfTable';
import { BufferType } from '../src/model/BufferType';
import { DeviceOperationLayoutTypes } from '../src/model/APIData';
import { BoundAnalysis } from '../src/definitions/PerfTable';
import { OperationCategories } from '../src/definitions/StackedPerfTable';
import { makeAllocationFailure } from './helpers/allocationFailure';
import { makeDramFallback } from './helpers/dramFallback';
import { makeRawPerfRow } from './helpers/perfRowFixtures';

// tt-perf-report emits a CSV whose columns (id, total_percent, bound, op_code, device, device_time,
// op_to_op_gap, cores, dram, dram_percent, flops, flops_percent, ...) reach the frontend as strings.
// enrichRowData converts those strings into the typed values the table renders. These tests verify
// that conversion faithfully reflects the values tt-perf-report produced — including the >6.5µs
// high-dispatch flag, which mirrors tt-perf-report's Op-to-Op Gap threshold (perf_report.py:1052).

describe('enrichRowData — typed conversion of tt-perf-report values', () => {
    it('parses numeric columns into numbers', () => {
        const [row] = enrichRowData([makeRawPerfRow()], [], null);

        expect(row.id).toBe(1);
        expect(row.total_percent).toBe(12.5);
        expect(row.device).toBe(0);
        expect(row.device_time).toBe(123.4);
        expect(row.op_to_op_gap).toBe(2.5);
        expect(row.cores).toBe(64);
        expect(row.dram).toBe(15.5);
        expect(row.dram_percent).toBe(42.1);
        expect(row.flops).toBe(88.8);
        expect(row.flops_percent).toBe(73.2);
        expect(row.pm_ideal_ns).toBe(1000);
    });

    it('parses the op category and bound analysis tt-perf-report 1.4.0 emits', () => {
        const [row] = enrichRowData([makeRawPerfRow({ op_category: 'CCL', bound_analysis: 'flops_only' })], [], null);

        expect(row.op_category).toBe(OperationCategories.CCL);
        expect(row.bound_analysis).toBe(BoundAnalysis.FLOPS_ONLY);
    });

    it('reads a missing or unrecognised op category and bound analysis as unknown', () => {
        const [missing, unrecognised] = enrichRowData(
            [makeRawPerfRow(), makeRawPerfRow({ op_category: 'Quantum', bound_analysis: 'partial' })],
            [],
            null,
        );

        expect(missing.op_category).toBeNull();
        expect(missing.bound_analysis).toBeNull();
        expect(unrecognised.op_category).toBeNull();
        expect(unrecognised.bound_analysis).toBeNull();
    });

    it('maps empty optional numeric columns to null', () => {
        const [row] = enrichRowData(
            [
                makeRawPerfRow({
                    op_to_op_gap: '',
                    dram: '',
                    dram_percent: '',
                    flops: '',
                    flops_percent: '',
                    pm_ideal_ns: '',
                }),
            ],
            [],
            null,
        );

        expect(row.op_to_op_gap).toBeNull();
        expect(row.dram).toBeNull();
        expect(row.dram_percent).toBeNull();
        expect(row.flops).toBeNull();
        expect(row.flops_percent).toBeNull();
        expect(row.pm_ideal_ns).toBeNull();
    });

    it('extracts buffer type and layout from input_0_memory', () => {
        const [row] = enrichRowData([makeRawPerfRow({ input_0_memory: 'DEV_0_L1_TILE' })], [], null);

        expect(row.buffer_type).toBe(BufferType.L1);
        expect(row.layout).toBe(DeviceOperationLayoutTypes.TILE);
    });

    describe('high_dispatch flag (tt-perf-report Op-to-Op Gap > 6.5µs)', () => {
        it('flags an op whose gap exceeds 6.5µs', () => {
            const [row] = enrichRowData([makeRawPerfRow({ op_to_op_gap: '7.0' })], [], null);

            expect(row.high_dispatch).toBe(true);
        });

        it('does not flag an op at or below 6.5µs', () => {
            const [row] = enrichRowData([makeRawPerfRow({ op_to_op_gap: '3.0' })], [], null);

            expect(row.high_dispatch).toBe(false);
        });

        it('does not flag an op with no gap', () => {
            const [row] = enrichRowData([makeRawPerfRow({ op_to_op_gap: '' })], [], null);

            expect(row.high_dispatch).toBe(false);
        });

        // Pins the decimal boundary: parsing with parseInt would truncate "6.6" to 6 and miss it.
        it('flags a fractional gap just over 6.5µs', () => {
            const [row] = enrichRowData([makeRawPerfRow({ op_to_op_gap: '6.6' })], [], null);

            expect(row.high_dispatch).toBe(true);
            expect(row.op_to_op_gap).toBe(6.6);
        });

        it('does not flag a gap exactly at 6.5µs', () => {
            const [row] = enrichRowData([makeRawPerfRow({ op_to_op_gap: '6.5' })], [], null);

            expect(row.high_dispatch).toBe(false);
        });
    });

    // tt-perf-report emits the per-RISC kernel durations as raw nanoseconds (CSV `[ns]` columns),
    // but the table declares those columns in µs. enrichRowData must convert ns -> µs so a 1.5ms
    // kernel renders as 1500 µs, not 1,500,000 µs (regression guard for the missing nsToUs call).
    describe('per-RISC kernel durations (ns -> µs)', () => {
        it('converts raw nanosecond strings into microseconds', () => {
            const [row] = enrichRowData(
                [
                    makeRawPerfRow({
                        device_kernel_duration: '1500000',
                        brisc_kernel_duration: '1234',
                        ncrisc_kernel_duration: '500',
                        trisc0_kernel_duration: '750',
                        trisc1_kernel_duration: '0',
                        trisc2_kernel_duration: '2500',
                        erisc_kernel_duration: '10',
                    } as Partial<PerfTableRow>),
                ],
                [],
                null,
            );

            expect(row.device_kernel_duration).toBe(1500);
            expect(row.brisc_kernel_duration).toBe(1.234);
            expect(row.ncrisc_kernel_duration).toBe(0.5);
            expect(row.trisc0_kernel_duration).toBe(0.75);
            expect(row.trisc2_kernel_duration).toBe(2.5);
            expect(row.erisc_kernel_duration).toBe(0.01);
        });

        it('maps absent or non-numeric kernel durations to null', () => {
            const [row] = enrichRowData(
                [
                    makeRawPerfRow({
                        device_kernel_duration: '',
                        brisc_kernel_duration: null,
                    } as Partial<PerfTableRow>),
                ],
                [],
                null,
            );

            expect(row.device_kernel_duration).toBeNull();
            expect(row.brisc_kernel_duration).toBeNull();
        });
    });

    describe('first-occurrence marking by hash', () => {
        it('marks only the first row of each hash as the first occurrence', () => {
            const rows = enrichRowData(
                [
                    makeRawPerfRow({ id: '1', hash: 'abc' }),
                    makeRawPerfRow({ id: '2', hash: 'abc' }),
                    makeRawPerfRow({ id: '3', hash: 'def' }),
                ],
                [],
                null,
            );

            expect(rows.map((row) => row.isFirstHashOccurrence)).toEqual([true, false, true]);
        });
    });

    it('attaches the op id from the perf-id lookup', () => {
        const [row] = enrichRowData([makeRawPerfRow({ id: '7' })], [{ perfId: '7', opId: 42 }], null);

        expect(row.op).toBe(42);
    });

    describe('linked operation data', () => {
        const failure = makeAllocationFailure({ operationId: 42 });
        const fallback = makeDramFallback({ operationId: 42 });
        const linkedOperationData: LinkedOperationData = {
            l1PressureByOpId: null,
            allocationFailureByOpId: new Map([[42, failure]]),
            dramFallbackByOpId: new Map([[42, fallback]]),
        };

        it("attaches the linked operation's failure and fallback, and nothing to other rows", () => {
            const [linked, other] = enrichRowData(
                [makeRawPerfRow({ id: '7' }), makeRawPerfRow({ id: '8' })],
                [
                    { perfId: '7', opId: 42 },
                    { perfId: '8', opId: 43 },
                ],
                linkedOperationData,
            );

            expect(linked.allocation_failure).toBe(failure);
            expect(linked.dram_fallback).toBe(fallback);
            expect(other.allocation_failure).toBeNull();
            expect(other.dram_fallback).toBeNull();
        });

        it('attaches nothing without linked data, as comparison datasets are enriched', () => {
            const [row] = enrichRowData([makeRawPerfRow({ id: '7' })], [{ perfId: '7', opId: 42 }], null);

            expect(row.allocation_failure).toBeNull();
            expect(row.dram_fallback).toBeNull();
        });

        it('attaches nothing to a row with no linked operation', () => {
            const [row] = enrichRowData([makeRawPerfRow({ id: '7' })], [], linkedOperationData);

            expect(row.allocation_failure).toBeNull();
            expect(row.dram_fallback).toBeNull();
        });
    });
});
