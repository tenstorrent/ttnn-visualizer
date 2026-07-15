// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PerfDurationHistogram from '../src/components/performance/PerfDurationHistogram';
import { OpType } from '../src/definitions/Performance';
import { PerfChartId } from '../src/definitions/PerformanceCharts';
import { TEST_IDS } from '../src/definitions/TestIds';
import { MarkerColours, TypedPerfTableRow } from '../src/definitions/PerfTable';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/libs/PlotComponent', () => ({
    default: () => <div data-testid='plot-mock' />,
}));

const row = (deviceTime: number): TypedPerfTableRow =>
    ({
        id: 1,
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        device_time: deviceTime,
    }) as TypedPerfTableRow;

afterEach(cleanup);

describe('PerfDurationHistogram', () => {
    it('renders the histogram container and chart title', () => {
        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={[row(5)]}
                    selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                />
            </TestProviders>,
        );

        expect(screen.getByTestId(TEST_IDS.PERF_DURATION_HISTOGRAM)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Op Duration Distribution' })).toBeInTheDocument();
        expect(document.getElementById(PerfChartId.OpDurationHistogram)).toBeInTheDocument();
    });

    it('keeps the chart anchor id when there are no eligible ops', () => {
        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={[row(0)]}
                    selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                />
            </TestProviders>,
        );

        expect(document.getElementById(PerfChartId.OpDurationHistogram)).toBeInTheDocument();
        expect(screen.getByText('No device ops available for duration histogram.')).toBeInTheDocument();
    });
});
