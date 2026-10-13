// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { BoundAnalysis, BoundType, ColumnKeys, Columns } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { describePlainCell, formatCellText, formatColumnNumber } from '../src/functions/perfFunctions';
import { NOT_MODELLED_REASON, SLOW_BOUND_REASON } from '../src/functions/perfBoundAnalysis';
import { TypedPerfTableRow } from '../src/model/PerfTable';

const makeRow = (overrides: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        id: 12345,
        op_type: OpType.DEVICE_OP,
        raw_op_code: 'SomeDeviceOp',
        op_code: 'SomeDeviceOp',
        op_category: 'Compute',
        total_percent: 5,
        bound: null,
        bound_analysis: BoundAnalysis.NONE,
        device_time: 1234.56,
        dram: null,
        dram_percent: null,
        flops: null,
        flops_percent: null,
        isFirstHashOccurrence: true,
        ...overrides,
    }) as TypedPerfTableRow;

const getColumn = (key: ColumnKeys) => Columns.find((column) => column.key === key)!;

describe('formatColumnNumber', () => {
    it("rounds to the column's decimals and appends its unit", () => {
        expect(formatColumnNumber(1234.56, getColumn(ColumnKeys.DeviceTime))).toBe('1,235 µs');
        expect(formatColumnNumber(12.345, getColumn(ColumnKeys.Dram))).toBe('12.3 GB/s');
    });

    it('formats a percent column as a percentage', () => {
        expect(formatColumnNumber(12.34, getColumn(ColumnKeys.TotalPercent))).toBe('12.3%');
    });

    it('prints an id without a thousands separator', () => {
        expect(formatColumnNumber(12345, getColumn(ColumnKeys.Id))).toBe('12345');
    });
});

describe('formatCellText', () => {
    it('formats a numeric cell as its column shows a number', () => {
        expect(formatCellText(makeRow(), getColumn(ColumnKeys.DeviceTime))).toBe('1,235 µs');
        expect(formatCellText(makeRow(), getColumn(ColumnKeys.Id))).toBe('12345');
    });

    it('passes a text cell through', () => {
        expect(formatCellText(makeRow(), getColumn(ColumnKeys.OpCategory))).toBe('Compute');
    });

    it.each([null, '', Number.NaN])('leaves a %s cell blank', (value) => {
        const row = makeRow({ device_time: value as TypedPerfTableRow['device_time'] });

        expect(formatCellText(row, getColumn(ColumnKeys.DeviceTime))).toBe('');
    });
});

describe('describePlainCell', () => {
    it('gives the text and colour the table would', () => {
        const cell = describePlainCell(makeRow(), getColumn(ColumnKeys.DeviceTime));

        expect(cell.text).toBe('1,235 µs');
        expect(cell.colour).toBeDefined();
        expect(cell.notAnalysedReason).toBeNull();
        expect(cell.slowExplanation).toBeNull();
    });

    it('blanks the columns the table blanks for a host op, keeping its category and bound', () => {
        const host = makeRow({ bound: BoundType.HOST, dram: 10 });

        expect(describePlainCell(host, getColumn(ColumnKeys.DeviceTime)).text).toBe('');
        expect(describePlainCell(host, getColumn(ColumnKeys.Dram)).text).toBe('');
        expect(describePlainCell(host, getColumn(ColumnKeys.OpCategory)).text).toBe('Compute');
        expect(describePlainCell(host, getColumn(ColumnKeys.Bound)).text).toBe(BoundType.HOST);
    });

    it('blanks every column but the id and op code for a signpost', () => {
        const signpost = makeRow({ op_type: OpType.SIGNPOST });

        expect(describePlainCell(signpost, getColumn(ColumnKeys.DeviceTime)).text).toBe('');
        expect(describePlainCell(signpost, getColumn(ColumnKeys.OpCategory)).text).toBe('');
        expect(describePlainCell(signpost, getColumn(ColumnKeys.Id)).text).toBe('12345');
    });

    it('says why an empty roofline cell was never analysed, except on a host op', () => {
        expect(describePlainCell(makeRow(), getColumn(ColumnKeys.Dram)).notAnalysedReason).toBe(NOT_MODELLED_REASON);
        expect(
            describePlainCell(makeRow({ bound: BoundType.HOST }), getColumn(ColumnKeys.Dram)).notAnalysedReason,
        ).toBeNull();
    });

    it("explains a SLOW row's roofline cells", () => {
        const slow = makeRow({
            bound: BoundType.SLOW,
            bound_analysis: BoundAnalysis.FULL,
            dram: 10,
            dram_percent: 20,
            flops: 5,
            flops_percent: 10,
        });

        expect(describePlainCell(slow, getColumn(ColumnKeys.Bound)).slowExplanation).toBe(SLOW_BOUND_REASON);
    });
});
