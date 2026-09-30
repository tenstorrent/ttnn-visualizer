// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BoundAnalysis, BoundType, ColumnKeys, Columns } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { TEST_IDS } from '../src/definitions/TestIds';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import {
    FLOPS_ONLY_REASON,
    MISSING_INPUTS_REASON,
    NOT_ANALYSED_LABEL,
    NOT_MODELLED_REASON,
    getBoundAnalysisCoverage,
    getNotAnalysedReason,
} from '../src/functions/perfBoundAnalysis';
import { formatCell } from '../src/functions/perfFunctions';
import PerfBoundAnalysisCoverage from '../src/components/performance/PerfBoundAnalysisCoverage';

const makeRow = (overrides: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        raw_op_code: 'SomeDeviceOp',
        op_code: 'SomeDeviceOp',
        total_percent: 5,
        bound: null,
        bound_analysis: BoundAnalysis.NONE,
        device_time: 10,
        dram: null,
        dram_percent: null,
        flops: null,
        flops_percent: null,
        isFirstHashOccurrence: true,
        ...overrides,
    }) as TypedPerfTableRow;

afterEach(cleanup);

const getColumn = (key: ColumnKeys) => Columns.find((column) => column.key === key)!;

const renderCell = (row: TypedPerfTableRow, key: ColumnKeys) => {
    const cell = formatCell(row, getColumn(key));

    return typeof cell === 'string' ? cell : render(<>{cell}</>).container.textContent;
};

const ROOFLINE_KEYS = [
    ColumnKeys.Bound,
    ColumnKeys.Dram,
    ColumnKeys.DramPercent,
    ColumnKeys.Flops,
    ColumnKeys.FlopsPercent,
];

describe('getNotAnalysedReason', () => {
    it.each(ROOFLINE_KEYS)('says %s was never modelled for an op with no roofline model', (key) => {
        expect(getNotAnalysedReason(makeRow(), key)).toBe(NOT_MODELLED_REASON);
    });

    it.each([ColumnKeys.Bound, ColumnKeys.Dram, ColumnKeys.DramPercent])(
        'says a convolution has no DRAM model for %s',
        (key) => {
            expect(getNotAnalysedReason(makeRow({ bound_analysis: BoundAnalysis.FLOPS_ONLY }), key)).toBe(
                FLOPS_ONLY_REASON,
            );
        },
    );

    it('treats a blank FLOPs figure on a convolution as missing inputs, not as unmodelled', () => {
        expect(
            getNotAnalysedReason(makeRow({ bound_analysis: BoundAnalysis.FLOPS_ONLY }), ColumnKeys.FlopsPercent),
        ).toBe(MISSING_INPUTS_REASON);
    });

    it('treats a blank figure on a fully modelled op as missing inputs', () => {
        expect(getNotAnalysedReason(makeRow({ bound_analysis: BoundAnalysis.FULL }), ColumnKeys.DramPercent)).toBe(
            MISSING_INPUTS_REASON,
        );
    });

    it('gives no reason without bound analysis, for signposts, or outside the roofline columns', () => {
        expect(getNotAnalysedReason(makeRow({ bound_analysis: null }), ColumnKeys.DramPercent)).toBeNull();
        expect(getNotAnalysedReason(makeRow({ op_type: OpType.SIGNPOST }), ColumnKeys.DramPercent)).toBeNull();
        expect(getNotAnalysedReason(makeRow(), ColumnKeys.Cores)).toBeNull();
    });
});

describe('formatCell roofline blanks', () => {
    it('marks an unanalysed figure as n/a instead of leaving it blank', () => {
        expect(renderCell(makeRow(), ColumnKeys.DramPercent)).toBe(NOT_ANALYSED_LABEL);
    });

    it('still renders a measured figure, including a measured 0%', () => {
        const row = makeRow({ bound_analysis: BoundAnalysis.FULL, dram_percent: 0, bound: BoundType.SLOW });

        expect(renderCell(row, ColumnKeys.DramPercent)).toBe('0%');
        expect(renderCell(row, ColumnKeys.Bound)).toBe(BoundType.SLOW);
    });

    it('keeps host op figures blank, since HOST already explains them', () => {
        const row = makeRow({ bound: BoundType.HOST, raw_op_code: 'aten::foo (torch)' });

        expect(renderCell(row, ColumnKeys.DramPercent)).toBe('');
        expect(renderCell(row, ColumnKeys.Bound)).toBe(BoundType.HOST);
    });

    it('keeps blanks for rows from a tt-perf-report without bound analysis', () => {
        expect(renderCell(makeRow({ bound_analysis: null }), ColumnKeys.DramPercent)).toBe('');
    });
});

describe('getBoundAnalysisCoverage', () => {
    it('splits device time by which roofline model ran', () => {
        const coverage = getBoundAnalysisCoverage([
            makeRow({ bound_analysis: BoundAnalysis.FULL, device_time: 20 }),
            makeRow({ bound_analysis: BoundAnalysis.FLOPS_ONLY, device_time: 30 }),
            makeRow({ bound_analysis: BoundAnalysis.NONE, device_time: 50 }),
        ]);

        expect(coverage).toEqual({ analysedPercent: 50, fullPercent: 20, flopsOnlyPercent: 30 });
    });

    it('ignores rows with no device time or no bound analysis', () => {
        const coverage = getBoundAnalysisCoverage([
            makeRow({ bound_analysis: BoundAnalysis.FULL, device_time: 25 }),
            makeRow({ bound_analysis: BoundAnalysis.NONE, device_time: 75 }),
            makeRow({ bound: BoundType.HOST, device_time: null }),
            makeRow({ op_type: OpType.SIGNPOST, bound_analysis: null, device_time: null }),
            makeRow({ bound_analysis: null, device_time: 1000 }),
        ]);

        expect(coverage?.analysedPercent).toBe(25);
    });

    it('returns null when nothing reports bound analysis', () => {
        expect(getBoundAnalysisCoverage([makeRow({ bound_analysis: null })])).toBeNull();
        expect(getBoundAnalysisCoverage([])).toBeNull();
    });
});

describe('PerfBoundAnalysisCoverage', () => {
    it('states the share of device time the roofline models cover', () => {
        render(
            <PerfBoundAnalysisCoverage
                rows={[
                    makeRow({ bound_analysis: BoundAnalysis.FULL, device_time: 7.3 }),
                    makeRow({ bound_analysis: BoundAnalysis.NONE, device_time: 92.7 }),
                ]}
            />,
        );

        expect(screen.getByTestId(TEST_IDS.PERF_BOUND_ANALYSIS_COVERAGE).textContent).toContain(
            'Bound analysis covers 7.3% of device time',
        );
    });

    it('renders nothing without bound analysis data', () => {
        render(<PerfBoundAnalysisCoverage rows={[makeRow({ bound_analysis: null })]} />);

        expect(screen.queryByTestId(TEST_IDS.PERF_BOUND_ANALYSIS_COVERAGE)).toBeNull();
    });
});
