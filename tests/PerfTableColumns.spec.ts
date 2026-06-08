// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import {
    ColumnKeys,
    Columns,
    getEligiblePerfColumns,
    getFooterColumns,
    getVisiblePerfColumns,
} from '../src/definitions/PerfTable';

describe('PerfTable column helpers', () => {
    it('builds eligible columns from feature flags', () => {
        const eligibleColumns = getEligiblePerfColumns({
            hasOpIds: true,
            hasL1PressureData: true,
            hiliteHighDispatch: true,
            showHashColumn: true,
            hasNpe: true,
        });

        expect(eligibleColumns.map((column) => column.key)).toEqual([
            ColumnKeys.Id,
            ColumnKeys.OP,
            ColumnKeys.TotalPercent,
            ColumnKeys.L1Fullness,
            ColumnKeys.Bound,
            ColumnKeys.OpCode,
            ColumnKeys.Device,
            ColumnKeys.HighDispatch,
            ColumnKeys.BufferType,
            ColumnKeys.Layout,
            ColumnKeys.DeviceTime,
            ColumnKeys.OpToOpGap,
            ColumnKeys.Cores,
            ColumnKeys.Dram,
            ColumnKeys.DramPercent,
            ColumnKeys.Flops,
            ColumnKeys.FlopsPercent,
            ColumnKeys.MathFidelity,
            ColumnKeys.Hash,
            ColumnKeys.CacheHit,
            ColumnKeys.GlobalCallCount,
        ]);
    });

    it('keeps locked columns visible even when hidden', () => {
        const visibleColumns = getVisiblePerfColumns(Columns, [ColumnKeys.OpCode, ColumnKeys.DeviceTime]);

        expect(visibleColumns.map((column) => column.key)).not.toContain(ColumnKeys.DeviceTime);
        expect(visibleColumns.map((column) => column.key)).toContain(ColumnKeys.OpCode);
    });

    it('recomputes OP Code footer span when footerSpan:0 columns are hidden', () => {
        const visibleColumns = getVisiblePerfColumns(Columns, [ColumnKeys.Device, ColumnKeys.BufferType]);
        const footerColumns = getFooterColumns(visibleColumns);
        const opCodeFooter = footerColumns.find((column) => column.key === ColumnKeys.OpCode);

        expect(opCodeFooter?.footerSpan).toBe(1);
    });

    it('uses the default OP Code footer span when Device and Type remain visible', () => {
        const footerColumns = getFooterColumns(Columns);
        const opCodeFooter = footerColumns.find((column) => column.key === ColumnKeys.OpCode);

        expect(opCodeFooter?.footerSpan).toBe(3);
    });
});
