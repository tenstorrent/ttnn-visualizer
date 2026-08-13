// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layout } from 'plotly.js';
import { firePlotClick, getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import PerfOpCountVsRuntimeChart from '../src/components/performance/PerfOpCountVsRuntimeChart';
import { MarkerColours, TypedPerfTableRow } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { getPerfChartLayout } from '../src/definitions/PlotConfigurations';
import { TEST_IDS } from '../src/definitions/TestIds';
import { TestProviders } from './helpers/TestProviders';

const matmulMarker = { opCode: 'Matmul', colour: MarkerColours[0] };
const convMarker = { opCode: 'Conv2d', colour: MarkerColours[1] };

const row = (rawOpCode: string): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: rawOpCode,
        raw_op_code: rawOpCode,
        device_time: 10,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        id: 1,
    }) as unknown as TypedPerfTableRow;

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('PerfOpCountVsRuntimeChart', () => {
    it('builds bar traces with flat string customdata per point', () => {
        render(
            <TestProviders>
                <PerfOpCountVsRuntimeChart
                    datasets={[[row('Matmul'), row('Conv2d')]]}
                    selectedOpCodes={[matmulMarker, convMarker]}
                    onOpCodeClick={vi.fn()}
                />
            </TestProviders>,
        );

        const traces = getPlotInstances()[0]?.data as { customdata?: unknown }[] | undefined;
        expect(traces?.length).toBeGreaterThan(0);

        for (const trace of traces ?? []) {
            expect(trace.customdata).toEqual(expect.arrayContaining([expect.any(String)]));
            expect(trace.customdata).toHaveLength(1);
            expect(['Matmul', 'Conv2d']).toContain((trace.customdata as string[])[0]);
        }
    });

    it('calls onOpCodeClick with customdata from a bar segment click', () => {
        const onOpCodeClick = vi.fn();

        render(
            <TestProviders>
                <PerfOpCountVsRuntimeChart
                    datasets={[[row('Matmul'), row('Conv2d')]]}
                    selectedOpCodes={[matmulMarker, convMarker]}
                    onOpCodeClick={onOpCodeClick}
                />
            </TestProviders>,
        );

        firePlotClick({ points: [{ customdata: 'Matmul' }] } as never);

        expect(onOpCodeClick).toHaveBeenCalledWith('Matmul');
    });

    it('does not call onOpCodeClick when customdata is missing', () => {
        const onOpCodeClick = vi.fn();

        render(
            <TestProviders>
                <PerfOpCountVsRuntimeChart
                    datasets={[[row('Matmul')]]}
                    selectedOpCodes={[matmulMarker]}
                    onOpCodeClick={onOpCodeClick}
                />
            </TestProviders>,
        );

        firePlotClick({ points: [{}] } as never);

        expect(onOpCodeClick).not.toHaveBeenCalled();
    });

    it('does not wire plot onClick or show the hint when onOpCodeClick is omitted', () => {
        render(
            <TestProviders>
                <PerfOpCountVsRuntimeChart
                    datasets={[[row('Matmul')]]}
                    selectedOpCodes={[matmulMarker]}
                />
            </TestProviders>,
        );

        expect(screen.queryAllByTestId(TEST_IDS.PERF_CHART_HINT)).toHaveLength(0);
        expect(getPlotInstances()[0]?.onClick).toBeUndefined();
    });

    it('uses the shared chart layout margins rather than a zero margin override', () => {
        render(
            <TestProviders>
                <PerfOpCountVsRuntimeChart
                    datasets={[[row('Matmul')]]}
                    selectedOpCodes={[matmulMarker]}
                />
            </TestProviders>,
        );

        const plotLayout = getPlotInstances()[0]?.layout as Partial<Layout> | undefined;
        expect(plotLayout?.margin).toEqual(getPerfChartLayout().margin);
    });
});
