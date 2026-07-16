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
            hasNpe: true,
        });

        expect(eligibleColumns.map((column) => column.key)).toEqual([
            ColumnKeys.Id,
            ColumnKeys.OP,
            ColumnKeys.TotalPercent,
            ColumnKeys.L1Fullness,
            ColumnKeys.Bound,
            ColumnKeys.OpCode,
            ColumnKeys.Flags,
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
            ColumnKeys.DeviceKernelDuration,
            ColumnKeys.BriscKernelDuration,
            ColumnKeys.NcriscKernelDuration,
            ColumnKeys.Trisc0KernelDuration,
            ColumnKeys.Trisc1KernelDuration,
            ColumnKeys.Trisc2KernelDuration,
            ColumnKeys.EriscKernelDuration,
            ColumnKeys.Hash,
            ColumnKeys.CacheHit,
            ColumnKeys.GlobalCallCount,
        ]);
    });

    it('includes Flags, Hash, and Cache Hit in eligible columns by default', () => {
        const eligibleColumns = getEligiblePerfColumns({
            hasOpIds: false,
            hasL1PressureData: false,
            hiliteHighDispatch: false,
            hasNpe: false,
        });

        expect(eligibleColumns.map((column) => column.key)).toContain(ColumnKeys.Flags);
        expect(eligibleColumns.map((column) => column.key)).toContain(ColumnKeys.Hash);
        expect(eligibleColumns.map((column) => column.key)).toContain(ColumnKeys.CacheHit);
    });

    it('keeps locked columns visible even when hidden', () => {
        const visibleColumns = getVisiblePerfColumns(Columns, [ColumnKeys.OpCode, ColumnKeys.DeviceTime]);

        expect(visibleColumns.map((column) => column.key)).not.toContain(ColumnKeys.DeviceTime);
        expect(visibleColumns.map((column) => column.key)).toContain(ColumnKeys.OpCode);
    });

    it('recomputes OP Code footer span when Device and Type are hidden', () => {
        const visibleColumns = getVisiblePerfColumns(Columns, [ColumnKeys.Device, ColumnKeys.BufferType]);
        const footerColumns = getFooterColumns(visibleColumns);
        const opCodeFooter = footerColumns.find((column) => column.key === ColumnKeys.OpCode);

        // Flags remains visible (footerSpan: 0), so Op Code still absorbs it.
        expect(opCodeFooter?.footerSpan).toBe(2);
        expect(footerColumns.map((column) => column.key)).not.toContain(ColumnKeys.Flags);
    });

    it('absorbs Flags, Device, and Type into the OP Code footer span by default', () => {
        const footerColumns = getFooterColumns(Columns);
        const opCodeFooter = footerColumns.find((column) => column.key === ColumnKeys.OpCode);

        expect(opCodeFooter?.footerSpan).toBe(4);
        expect(footerColumns.map((column) => column.key)).not.toContain(ColumnKeys.Flags);
        expect(footerColumns.map((column) => column.key)).not.toContain(ColumnKeys.Device);
        expect(footerColumns.map((column) => column.key)).not.toContain(ColumnKeys.BufferType);
    });
});
