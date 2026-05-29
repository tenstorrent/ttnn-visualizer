// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { TypedPerfTableRow } from '../src/definitions/PerfTable';
import { buildL1PressureChartSeries } from '../src/functions/buildL1PressureChartSeries';

const baseRow = {
    l1_fullness_percent: 10,
    l1_largest_free_percent: 80,
    op_code: 'ttnn.matmul',
} as TypedPerfTableRow;

describe('buildL1PressureChartSeries', () => {
    it('emits one L1 sample per consecutive TTNN op group', () => {
        const rows = [
            { ...baseRow, op: 1, l1_fullness_percent: 30, l1_largest_free_percent: 55 },
            { ...baseRow, op: 1, l1_fullness_percent: 30, l1_largest_free_percent: 55 },
            { ...baseRow, op: 2, l1_fullness_percent: 5, l1_largest_free_percent: 95 },
        ] as TypedPerfTableRow[];

        const series = buildL1PressureChartSeries(rows);

        expect(series.x).toEqual([1, 2, 3]);
        expect(series.fullnessPercent).toEqual([30, null, 5]);
        expect(series.largestFreePercent).toEqual([55, null, 95]);
        expect(series.opCodes).toEqual(['ttnn.matmul', 'ttnn.matmul', 'ttnn.matmul']);
    });

    it('returns empty arrays for empty input', () => {
        const series = buildL1PressureChartSeries([]);

        expect(series.x).toEqual([]);
        expect(series.fullnessPercent).toEqual([]);
        expect(series.largestFreePercent).toEqual([]);
    });
});
