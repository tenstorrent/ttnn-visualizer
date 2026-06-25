// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { enrichRowData } from '../src/functions/enrichPerfRowData';
import { PerfTableRow } from '../src/definitions/PerfTable';
import { BufferType } from '../src/model/BufferType';
import { DeviceOperationLayoutTypes } from '../src/model/APIData';
import { OpType } from '../src/definitions/Performance';

// tt-perf-report emits a CSV whose columns (id, total_percent, bound, op_code, device, device_time,
// op_to_op_gap, cores, dram, dram_percent, flops, flops_percent, ...) reach the frontend as strings.
// enrichRowData converts those strings into the typed values the table renders. These tests verify
// that conversion faithfully reflects the values tt-perf-report produced — including the >6.5µs
// high-dispatch flag, which mirrors tt-perf-report's Op-to-Op Gap threshold (perf_report.py:1052).

// A raw row as delivered to the frontend (every field a string, matching the CSV-derived JSON).
const makeRawRow = (overrides: Partial<PerfTableRow> = {}): PerfTableRow =>
    ({
        id: '1',
        global_call_count: 0,
        advice: [],
        total_percent: '12.5',
        bound: 'DRAM',
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        device: '0',
        device_time: '123.4',
        op_to_op_gap: '2.5',
        cores: '64',
        dram: '15.5',
        dram_percent: '42.1',
        flops: '88.8',
        flops_percent: '73.2',
        math_fidelity: 'HiFi4',
        output_datatype: 'BFLOAT16',
        output_0_memory: '',
        input_0_datatype: 'BFLOAT16',
        input_1_datatype: 'BFLOAT16',
        dram_sharded: '',
        input_0_memory: 'DEV_0_DRAM_INTERLEAVED',
        input_1_memory: '',
        inner_dim_block_size: '',
        output_subblock_h: '',
        output_subblock_w: '',
        pm_ideal_ns: '1000',
        op_type: OpType.DEVICE_OP,
        hash: null,
        cache_hit: null,
        ...overrides,
    }) as PerfTableRow;

describe('enrichRowData — typed conversion of tt-perf-report values', () => {
    it('parses numeric columns into numbers', () => {
        const [row] = enrichRowData([makeRawRow()], [], null);

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

    it('maps empty optional numeric columns to null', () => {
        const [row] = enrichRowData(
            [
                makeRawRow({
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
        const [row] = enrichRowData([makeRawRow({ input_0_memory: 'DEV_0_L1_TILE' })], [], null);

        expect(row.buffer_type).toBe(BufferType.L1);
        expect(row.layout).toBe(DeviceOperationLayoutTypes.TILE);
    });

    describe('high_dispatch flag (tt-perf-report Op-to-Op Gap > 6.5µs)', () => {
        it('flags an op whose gap exceeds 6.5µs', () => {
            const [row] = enrichRowData([makeRawRow({ op_to_op_gap: '7.0' })], [], null);

            expect(row.high_dispatch).toBe(true);
        });

        it('does not flag an op at or below 6.5µs', () => {
            const [row] = enrichRowData([makeRawRow({ op_to_op_gap: '3.0' })], [], null);

            expect(row.high_dispatch).toBe(false);
        });

        it('does not flag an op with no gap', () => {
            const [row] = enrichRowData([makeRawRow({ op_to_op_gap: '' })], [], null);

            expect(row.high_dispatch).toBe(false);
        });
    });

    describe('first-occurrence marking by hash', () => {
        it('marks only the first row of each hash as the first occurrence', () => {
            const rows = enrichRowData(
                [
                    makeRawRow({ id: '1', hash: 'abc' }),
                    makeRawRow({ id: '2', hash: 'abc' }),
                    makeRawRow({ id: '3', hash: 'def' }),
                ],
                [],
                null,
            );

            expect(rows.map((row) => row.isFirstHashOccurrence)).toEqual([true, false, true]);
        });
    });

    it('attaches the op id from the perf-id lookup', () => {
        const [row] = enrichRowData([makeRawRow({ id: '7' })], [{ perfId: '7', opId: 42 }], null);

        expect(row.op).toBe(42);
    });
});
