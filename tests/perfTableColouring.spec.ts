// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { MathFidelity, evaluateFidelity, getCellColour } from '../src/functions/perfFunctions';
import { BoundType, ColumnKeys, TypedPerfTableRow } from '../src/definitions/PerfTable';
import { CellColour } from '../src/definitions/CellColour';
import { OpType } from '../src/definitions/Performance';

// These tests pin the performance table's cell colouring to the rules tt-perf-report applies in
// its `color_row` / `evaluate_fidelity` functions (tt_perf_report/perf_report.py). tt-perf-report
// is treated as the source of truth: the visualizer adds columns and features, but for the columns
// it shares with tt-perf-report the colours must match.
//
// Reference (perf_report.py):
//   - op_colors map ...................... lines 32-45
//   - default_cell_color = "white" ....... line 46  (an un-coloured cell renders neutral/white)
//   - muted_cell_color  = "grey" ......... line 47
//   - color_row() ........................ lines 1014-1075
//   - is_host_op() = "(torch)" in op_code  line 2092
//   - default --min-percentage = 0.5 ..... line 1834  (matches the visualizer's MIN_PERCENTAGE)
//   - evaluate_fidelity() ................ lines 532-623

// A device op comfortably above the 0.5% colouring threshold, with neutral defaults. Individual
// tests override the bound / value / op-code fields that drive each colouring rule.
const makeRow = (overrides: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        total_percent: 50,
        bound: null,
        raw_op_code: 'SomeDeviceOp',
        op_code: 'SomeDeviceOp',
        cores: 32,
        dram: null,
        dram_percent: null,
        flops: null,
        flops_percent: null,
        math_fidelity: '',
        input_0_datatype: '',
        input_1_datatype: '',
        output_datatype: '',
        cache_hit: null,
        op_to_op_gap: null,
        ...overrides,
    }) as unknown as TypedPerfTableRow;

describe('getCellColour — parity with tt-perf-report color_row()', () => {
    describe('Bound column', () => {
        // perf_report.py:1030-1037 — DRAM/FLOP bound ops are well-optimised → green.
        it('colours a DRAM-bound op green', () => {
            expect(getCellColour(makeRow({ bound: BoundType.DRAM }), ColumnKeys.Bound)).toBe(CellColour.Green);
        });

        it('colours a FLOP-bound op green', () => {
            expect(getCellColour(makeRow({ bound: BoundType.FLOP }), ColumnKeys.Bound)).toBe(CellColour.Green);
        });

        // perf_report.py:1038-1039 — SLOW bound → yellow warning.
        it('colours a SLOW-bound op yellow', () => {
            expect(getCellColour(makeRow({ bound: BoundType.SLOW }), ColumnKeys.Bound)).toBe(CellColour.Yellow);
        });

        // perf_report.py:1049-1050 — HOST bound → red.
        // DIVERGENCE: the visualizer returns CellColour.Green here (perfFunctions.tsx:274-276).
        it('colours a HOST-bound op red', () => {
            expect(getCellColour(makeRow({ bound: BoundType.HOST }), ColumnKeys.Bound)).toBe(CellColour.Red);
        });

        // perf_report.py — "BOTH" is never assigned a colour in color_row(), so it stays neutral.
        // DIVERGENCE: the visualizer falls through to FALLBACK_COLOUR (grey) for BOTH.
        it('leaves a BOTH-bound op neutral (white)', () => {
            expect(getCellColour(makeRow({ bound: BoundType.BOTH }), ColumnKeys.Bound)).toBe(CellColour.White);
        });
    });

    describe('DRAM / FLOPS columns', () => {
        // perf_report.py:1031-1033 — DRAM bound highlights the DRAM throughput columns green.
        it('colours DRAM and DRAM % green for a DRAM-bound op', () => {
            const row = makeRow({ bound: BoundType.DRAM });

            expect(getCellColour(row, ColumnKeys.Dram)).toBe(CellColour.Green);
            expect(getCellColour(row, ColumnKeys.DramPercent)).toBe(CellColour.Green);
        });

        // perf_report.py:1035-1037 — FLOP bound highlights the FLOPS columns green.
        it('colours FLOPS and FLOPS % green for a FLOP-bound op', () => {
            const row = makeRow({ bound: BoundType.FLOP });

            expect(getCellColour(row, ColumnKeys.Flops)).toBe(CellColour.Green);
            expect(getCellColour(row, ColumnKeys.FlopsPercent)).toBe(CellColour.Green);
        });

        // perf_report.py:1040-1045 — SLOW bound: the larger of DRAM% / FLOPS% gets the yellow flag.
        it('flags the DRAM columns yellow when SLOW and DRAM% > FLOPS%', () => {
            const row = makeRow({ bound: BoundType.SLOW, dram_percent: 80, flops_percent: 10 });

            expect(getCellColour(row, ColumnKeys.Dram)).toBe(CellColour.Yellow);
            expect(getCellColour(row, ColumnKeys.DramPercent)).toBe(CellColour.Yellow);
            expect(getCellColour(row, ColumnKeys.Flops)).toBe(CellColour.White);
        });

        // perf_report.py:1046-1048 — otherwise the FLOPS columns get the yellow flag.
        it('flags the FLOPS columns yellow when SLOW and FLOPS% >= DRAM%', () => {
            const row = makeRow({ bound: BoundType.SLOW, dram_percent: 10, flops_percent: 80 });

            expect(getCellColour(row, ColumnKeys.Flops)).toBe(CellColour.Yellow);
            expect(getCellColour(row, ColumnKeys.FlopsPercent)).toBe(CellColour.Yellow);
            expect(getCellColour(row, ColumnKeys.Dram)).toBe(CellColour.White);
        });

        // perf_report.py — HOST bound only colours the Bound cell; the DRAM/FLOPS cells stay neutral.
        // DIVERGENCE: the visualizer colours all four DRAM/FLOPS cells red for HOST (perfFunctions.tsx:309-311).
        it('leaves the DRAM/FLOPS columns neutral for a HOST-bound op', () => {
            const row = makeRow({ bound: BoundType.HOST });

            expect(getCellColour(row, ColumnKeys.Dram)).toBe(CellColour.White);
            expect(getCellColour(row, ColumnKeys.Flops)).toBe(CellColour.White);
        });
    });

    describe('Cores column', () => {
        // perf_report.py:1021-1028 — <10 red, ==64 green, otherwise neutral, missing → grey.
        it('colours fewer than 10 cores red', () => {
            expect(getCellColour(makeRow({ cores: 4 }), ColumnKeys.Cores)).toBe(CellColour.Red);
        });

        it('colours exactly 64 cores green', () => {
            expect(getCellColour(makeRow({ cores: 64 }), ColumnKeys.Cores)).toBe(CellColour.Green);
        });

        it('leaves an intermediate core count (10-63) neutral (white)', () => {
            expect(getCellColour(makeRow({ cores: 32 }), ColumnKeys.Cores)).toBe(CellColour.White);
        });

        it('mutes a missing core count to grey', () => {
            expect(getCellColour(makeRow({ cores: null }), ColumnKeys.Cores)).toBe(CellColour.Grey);
        });
    });

    describe('OP Code column', () => {
        // perf_report.py:32-45 + get_op_color() — substring match against the op_colors map.
        it.each([
            ['(torch)', CellColour.Red],
            ['Matmul', CellColour.Magenta],
            ['OptimizedConvNew', CellColour.Orange],
            ['Conv2d', CellColour.Orange],
            ['LayerNorm', CellColour.Cyan],
            ['AllGather', CellColour.Cyan],
            ['AllReduce', CellColour.Cyan],
            ['ScaledDotProductAttentionDecode', CellColour.Blue],
            ['ScaledDotProductAttentionGQADecode', CellColour.Blue],
            ['NlpCreateHeadsDeviceOperation', CellColour.Blue],
            ['NLPConcatHeadsDecodeDeviceOperation', CellColour.Blue],
            ['UpdateCache', CellColour.Blue],
        ])('colours op code containing %s as %s', (rawOpCode, expected) => {
            expect(getCellColour(makeRow({ raw_op_code: rawOpCode }), ColumnKeys.OpCode)).toBe(expected);
        });

        it('matches op codes by substring', () => {
            expect(getCellColour(makeRow({ raw_op_code: 'ttnn.Matmul' }), ColumnKeys.OpCode)).toBe(CellColour.Magenta);
        });

        it('leaves an unmapped op code neutral (white)', () => {
            expect(getCellColour(makeRow({ raw_op_code: 'Softmax' }), ColumnKeys.OpCode)).toBe(CellColour.White);
        });
    });

    describe('Op-to-Op Gap column', () => {
        // perf_report.py:1052-1053 — gap > 6.5µs → red.
        it('colours a gap over 6.5µs red', () => {
            expect(getCellColour(makeRow({ op_to_op_gap: 7 }), ColumnKeys.OpToOpGap)).toBe(CellColour.Red);
        });

        // perf_report.py — gaps at or below the threshold are never coloured, so they stay neutral.
        // DIVERGENCE: the visualizer returns FALLBACK_COLOUR (grey) (perfFunctions.tsx:395-397).
        it('leaves a gap at or below 6.5µs neutral (white)', () => {
            expect(getCellColour(makeRow({ op_to_op_gap: 3 }), ColumnKeys.OpToOpGap)).toBe(CellColour.White);
        });
    });

    describe('Math Fidelity column', () => {
        const matmulFidelityRow = (overrides: Partial<TypedPerfTableRow> = {}) =>
            makeRow({
                raw_op_code: 'Matmul',
                op_code: 'Matmul',
                input_0_datatype: 'BFLOAT16',
                input_1_datatype: 'BFLOAT16',
                output_datatype: 'BFLOAT16',
                ...overrides,
            });

        // perf_report.py:1066-1073 — fidelity verdict drives the colour for Matmul/Conv ops.
        it('colours a sufficient fidelity green', () => {
            expect(getCellColour(matmulFidelityRow({ math_fidelity: 'HiFi4' }), ColumnKeys.MathFidelity)).toBe(
                CellColour.Green,
            );
        });

        it('colours a too-high fidelity red', () => {
            const row = matmulFidelityRow({ math_fidelity: 'HiFi4', output_datatype: 'BFLOAT4_B' });

            expect(getCellColour(row, ColumnKeys.MathFidelity)).toBe(CellColour.Red);
        });

        it('colours a too-low fidelity cyan', () => {
            expect(getCellColour(matmulFidelityRow({ math_fidelity: 'HiFi2' }), ColumnKeys.MathFidelity)).toBe(
                CellColour.Cyan,
            );
        });

        // perf_report.py:1055-1056 — fidelity is only coloured for Matmul / OptimizedConvNew ops.
        // DIVERGENCE: the visualizer colours the fidelity cell for any op (perfFunctions.tsx:348-369).
        it('leaves fidelity neutral for a non-Matmul/Conv op', () => {
            const row = makeRow({
                raw_op_code: 'Softmax',
                op_code: 'Softmax',
                math_fidelity: 'HiFi4',
                input_0_datatype: 'BFLOAT16',
                input_1_datatype: 'BFLOAT16',
                output_datatype: 'BFLOAT16',
            });

            expect(getCellColour(row, ColumnKeys.MathFidelity)).toBe(CellColour.White);
        });
    });

    describe('Low-impact rows (< 0.5% of total)', () => {
        // perf_report.py:1015-1017 — ops below the threshold are muted grey, EXCEPT host "(torch)" ops.
        it('mutes a sub-threshold device op to grey', () => {
            const row = makeRow({ total_percent: 0.3, bound: BoundType.DRAM });

            expect(getCellColour(row, ColumnKeys.Bound)).toBe(CellColour.Grey);
        });

        // perf_report.py:1015 + 2092 — "(torch)" host ops are exempt from muting; their op code stays red.
        it('does not mute a sub-threshold host (torch) op', () => {
            const row = makeRow({
                op_type: OpType.PYTHON_OP,
                total_percent: 0.3,
                raw_op_code: '(torch) aten::add',
                op_code: '(torch) aten::add',
            });

            expect(getCellColour(row, ColumnKeys.OpCode)).toBe(CellColour.Red);
        });
    });

    describe('Always-neutral columns', () => {
        // perf_report.py — ID / Total % / Device Time carry no conditional colour.
        it.each([ColumnKeys.Id, ColumnKeys.TotalPercent, ColumnKeys.DeviceTime])('leaves %s neutral (white)', (key) => {
            expect(getCellColour(makeRow({ bound: BoundType.HOST }), key)).toBe(CellColour.White);
        });
    });
});

describe('evaluateFidelity — parity with tt-perf-report evaluate_fidelity()', () => {
    // perf_report.py:558-616 — only the verdict (first element) drives colour; we assert that.
    it.each<[string, string, string, MathFidelity, string]>([
        // in0 = 8 bits, out >= 7 (perf_report.py:558-567)
        ['BFLOAT16', 'BFLOAT16', 'BFLOAT16', MathFidelity.HiFi4, 'sufficient'],
        ['BFLOAT16', 'BFLOAT16', 'BFLOAT16', MathFidelity.HiFi2, 'too_low'],
        ['BFLOAT16', 'BFLOAT16', 'BFLOAT16', MathFidelity.LoFi, 'too_low'],
        // in0 = 8 bits, out = 3 bits (perf_report.py:570-585)
        ['BFLOAT16', 'BFLOAT16', 'BFLOAT4_B', MathFidelity.HiFi4, 'too_high'],
        ['BFLOAT16', 'BFLOAT16', 'BFLOAT4_B', MathFidelity.HiFi2, 'sufficient'],
        ['BFLOAT16', 'BFLOAT16', 'BFLOAT4_B', MathFidelity.LoFi, 'too_low'],
        // in1 >= 7 bits, out >= 7 (perf_report.py:588-596)
        ['BFLOAT8_B', 'BFLOAT8_B', 'BFLOAT16', MathFidelity.HiFi4, 'too_high'],
        ['BFLOAT8_B', 'BFLOAT8_B', 'BFLOAT16', MathFidelity.HiFi2, 'sufficient'],
        ['BFLOAT8_B', 'BFLOAT8_B', 'BFLOAT16', MathFidelity.LoFi, 'too_low'],
        // in1 = 3 bits (perf_report.py:612-616)
        ['BFLOAT8_B', 'BFLOAT4_B', 'BFLOAT16', MathFidelity.LoFi, 'sufficient'],
        ['BFLOAT8_B', 'BFLOAT4_B', 'BFLOAT16', MathFidelity.HiFi4, 'too_high'],
    ])('evaluates %s/%s -> %s at %s as %s', (in0, in1, out, fidelity, expected) => {
        const [verdict] = evaluateFidelity(in0, in1, out, fidelity);

        expect(verdict).toBe(expected);
    });

    // perf_report.py:535-545 — integer datatypes short-circuit to "not_applicable".
    // DIVERGENCE: the visualizer has no integer guard and returns "unknown" (perfFunctions.tsx:458-525).
    it('reports integer datatypes as not_applicable', () => {
        const [verdict] = evaluateFidelity('UINT8', 'BFLOAT16', 'BFLOAT16', MathFidelity.HiFi4);

        expect(verdict).toBe('not_applicable');
    });

    // perf_report.py:552-556 — unsupported datatypes report "unknown".
    it('reports unsupported datatypes as unknown', () => {
        const [verdict] = evaluateFidelity('MADE_UP', 'BFLOAT16', 'BFLOAT16', MathFidelity.HiFi4);

        expect(verdict).toBe('unknown');
    });
});
