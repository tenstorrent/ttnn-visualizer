// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firePlotClick, getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfOperationTypesChart from '../src/components/performance/PerfOperationTypesChart';
import { MarkerColours, TypedPerfTableRow } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { TEST_IDS } from '../src/definitions/TestIds';
import { TestProviders } from './helpers/TestProviders';

const matmulMarker = { opCode: 'Matmul', colour: MarkerColours[0] };
const convMarker = { opCode: 'Conv2d', colour: MarkerColours[1] };

const row = (rawOpCode: string, id: number): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: rawOpCode,
        raw_op_code: rawOpCode,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        id,
    }) as unknown as TypedPerfTableRow;

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('PerfOperationTypesChart', () => {
    it('builds the pie trace with flat string customdata per slice', () => {
        render(
            <TestProviders>
                <PerfOperationTypesChart
                    reportTitle='active-report'
                    data={[row('Matmul', 1), row('Conv2d', 2)]}
                    opCodes={[matmulMarker, convMarker]}
                    onOpCodeClick={vi.fn()}
                />
            </TestProviders>,
        );

        const pie = getPlotInstances()[0]?.data?.[0] as { customdata?: unknown } | undefined;
        expect(Array.isArray(pie?.customdata)).toBe(true);
        expect(pie?.customdata).toEqual(['Matmul', 'Conv2d']);
        expect((pie?.customdata as unknown[]).every((value) => typeof value === 'string')).toBe(true);
    });

    it('calls onOpCodeClick when a pie slice is clicked', () => {
        const onOpCodeClick = vi.fn();

        render(
            <TestProviders>
                <PerfOperationTypesChart
                    reportTitle='active-report'
                    data={[row('Matmul', 1), row('Conv2d', 2)]}
                    opCodes={[matmulMarker, convMarker]}
                    onOpCodeClick={onOpCodeClick}
                />
            </TestProviders>,
        );

        firePlotClick({ points: [{ customdata: 'Conv2d', label: 'Conv2d' }] } as never);

        expect(onOpCodeClick).toHaveBeenCalledWith('Conv2d');
        expect(screen.getByTestId(TEST_IDS.PERF_CHART_TABLE_FILTER_HINT)).toBeInTheDocument();
    });

    it('wires separate chart instances for active and comparison data', () => {
        const onOpCodeClick = vi.fn();

        render(
            <TestProviders>
                <div>
                    <PerfOperationTypesChart
                        reportTitle='active-report'
                        data={[row('Matmul', 1)]}
                        opCodes={[matmulMarker, convMarker]}
                        onOpCodeClick={onOpCodeClick}
                    />
                    <PerfOperationTypesChart
                        reportTitle='comparison-report'
                        data={[row('Conv2d', 2)]}
                        opCodes={[matmulMarker, convMarker]}
                        onOpCodeClick={onOpCodeClick}
                    />
                </div>
            </TestProviders>,
        );

        expect(getPlotInstances()).toHaveLength(2);

        const comparisonOnClick = getPlotInstances()[1]?.onClick as
            | ((event: { points: { customdata: string }[] }) => void)
            | undefined;
        comparisonOnClick?.({ points: [{ customdata: 'Conv2d' }] });

        expect(onOpCodeClick).toHaveBeenCalledWith('Conv2d');
    });

    it('does not wire plot onClick or show the hint when onOpCodeClick is omitted', () => {
        render(
            <TestProviders>
                <PerfOperationTypesChart
                    reportTitle='active-report'
                    data={[row('Matmul', 1)]}
                    opCodes={[matmulMarker, convMarker]}
                />
            </TestProviders>,
        );

        expect(screen.queryByTestId(TEST_IDS.PERF_CHART_TABLE_FILTER_HINT)).not.toBeInTheDocument();
        expect(getPlotInstances()[0]?.onClick).toBeUndefined();
    });
});
