// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { MathFidelity, evaluateFidelity, getCellColour } from '../src/functions/perfFunctions';
import { ColumnKeys, TypedPerfTableRow } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import golden from './data/perfReportColourContract.json';

// These tests pin the performance table's cell colouring to tt-perf-report by consuming a golden
// file GENERATED from the real installed package by the Python contract test
// (backend/ttnn_visualizer/tests/test_perf_report_contract.py).
//
// Chain of trust: tt-perf-report -> golden -> these tests.
//   * If tt-perf-report changes its rules, the Python test regenerates a different golden and fails
//     until reconciled — so the expectations here are never a stale hand-transcription.
//   * If getCellColour / evaluateFidelity drift from those rules, the assertions below fail.
//
// The golden's `row` entries use frontend field names, so each one is spread straight onto a row.

const makeRow = (overrides: Record<string, unknown>): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: overrides.raw_op_code,
        cache_hit: null,
        isFirstHashOccurrence: true,
        advice: [],
        ...overrides,
    }) as unknown as TypedPerfTableRow;

describe('getCellColour — golden parity with tt-perf-report color_row()', () => {
    it.each(golden.colours)('$id ($column) -> $expected', ({ column, row, expected }) => {
        expect(getCellColour(makeRow(row), column as ColumnKeys)).toBe(expected);
    });
});

describe('evaluateFidelity — golden parity with tt-perf-report evaluate_fidelity()', () => {
    it.each(golden.fidelity)(
        '$id -> $expected',
        ({ input_0: input0, input_1: input1, output, math_fidelity: mathFidelity, expected }) => {
            const [verdict] = evaluateFidelity(input0, input1, output, mathFidelity as MathFidelity | '');

            expect(verdict).toBe(expected);
        },
    );
});
