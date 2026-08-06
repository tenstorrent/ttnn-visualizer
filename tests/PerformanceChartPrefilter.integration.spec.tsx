// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlotInstances, resetPlotPropsCapture } from './mocks/plotComponent';
import Performance from '../src/routes/Performance';
import { OpType } from '../src/definitions/Performance';
import { TypedPerfTableRow } from '../src/definitions/PerfTable';
import { PERF_CHART_TRANSPARENT } from '../src/definitions/PlotConfigurations';
import {
    useGetNPEManifest,
    useL1PressureByOperation,
    useOpToPerfIdFiltered,
    useOperationsList,
    usePerfFolderList,
    usePerfMeta,
    usePerfMetas,
    usePerformanceComparisonReport,
    usePerformanceRange,
    usePerformanceReport,
} from '../src/hooks/useAPI';
import { L1PressureStatus } from '../src/model/L1Pressure';
import { TEST_IDS } from '../src/definitions/TestIds';
import { activePerformanceReportAtom, selectedPerformanceRangeAtom } from '../src/store/app';
import { setUpScrollResetMocks } from './helpers/mockScrollReset';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetNPEManifest: vi.fn(),
    useL1PressureByOperation: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
    useOperationsList: vi.fn(),
    usePerfFolderList: vi.fn(),
    usePerfMeta: vi.fn(),
    usePerfMetas: vi.fn(),
    usePerformanceComparisonReport: vi.fn(),
    usePerformanceRange: vi.fn(),
    usePerformanceReport: vi.fn(),
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => ({ SERVER_MODE: true }),
}));

const row = (opCode: string, id: number, deviceTime = 10): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: opCode,
        raw_op_code: opCode,
        device_time: deviceTime,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        id,
    }) as unknown as TypedPerfTableRow;

// Only the duration histogram wires annotation clicks, so this identifies it among the charts
const getHistogramInstances = () =>
    getPlotInstances().filter((instance) => typeof instance.onClickAnnotation === 'function');

const getHistogramLayout = () => getHistogramInstances().at(-1)?.layout as { annotations?: unknown[] } | undefined;

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

beforeEach(() => {
    setUpScrollResetMocks();

    (usePerformanceReport as Mock).mockReturnValue({
        data: {
            report: [row('Matmul', 1), row('Conv2d', 2)],
            stacked_report: [],
            signposts: [],
        },
        isLoading: false,
        error: null,
    });
    (usePerformanceComparisonReport as Mock).mockReturnValue({ data: [] });
    (usePerformanceRange as Mock).mockReturnValue([1, 2]);
    (usePerfFolderList as Mock).mockReturnValue({ data: [] });
    (useGetNPEManifest as Mock).mockReturnValue({ data: [], error: null });
    (useOpToPerfIdFiltered as Mock).mockReturnValue([]);
    (useOperationsList as Mock).mockReturnValue({ data: [] });
    (usePerfMeta as Mock).mockReturnValue({ data: null, isLoading: false });
    (usePerfMetas as Mock).mockReturnValue([]);
    (useL1PressureByOperation as Mock).mockReturnValue({ status: L1PressureStatus.Unavailable, data: null });
});

describe('Performance chart prefilter integration', () => {
    it('clicking an operation chart point switches to table tab and filters rows', async () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, { path: '/reports/report-a', reportName: 'report-a' }],
                    [selectedPerformanceRangeAtom, [1, 2]],
                ]}
            >
                <Performance />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('tab', { name: 'Charts' }));

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: 'Table', selected: false })).toBeInTheDocument();
        });

        const onClick = getPlotInstances().find((instance) => typeof instance.onClick === 'function')?.onClick as
            | ((event: { points: { customdata?: unknown }[] }) => void)
            | undefined;
        expect(onClick).toBeDefined();

        onClick?.({ points: [{ customdata: 'Matmul' }] } as never);

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: 'Table', selected: true })).toBeInTheDocument();
        });

        const table = screen.getByRole('table');
        expect(within(table).getAllByText('Matmul').length).toBeGreaterThan(0);
        expect(within(table).queryByText('Conv2d')).not.toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.PERF_TABLE_SKELETON)).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Charts', selected: false })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Table', selected: true })).toBeInTheDocument();
    });

    it('clicking an operation types pie slice switches to table tab and filters rows', async () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, { path: '/reports/report-a', reportName: 'report-a' }],
                    [selectedPerformanceRangeAtom, [1, 2]],
                ]}
            >
                <Performance />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('tab', { name: 'Charts' }));

        await waitFor(() => {
            expect(
                getPlotInstances().some((instance) => (instance.data as { type?: string }[])?.[0]?.type === 'pie'),
            ).toBe(true);
        });

        const opTypesOnClick = getPlotInstances().find(
            (instance) =>
                Array.isArray(instance.data) &&
                (instance.data as { type?: string }[])[0]?.type === 'pie' &&
                typeof instance.onClick === 'function',
        )?.onClick as ((event: { points: { customdata?: unknown; label?: string }[] }) => void) | undefined;
        expect(opTypesOnClick).toBeDefined();

        opTypesOnClick?.({ points: [{ customdata: 'Conv2d', label: 'Conv2d' }] } as never);

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: 'Table', selected: true })).toBeInTheDocument();
        });

        const table = screen.getByRole('table');
        expect(within(table).getAllByText('Conv2d').length).toBeGreaterThan(0);
        expect(within(table).queryByText('Matmul')).not.toBeInTheDocument();
    });

    it('clicking a duration bucket control switches to table tab and filters rows', async () => {
        // Straddling three decades so the clicked bucket is not the only one the histogram draws
        (usePerformanceReport as Mock).mockReturnValue({
            data: {
                report: [row('Matmul', 1, 5), row('Conv2d', 2, 500)],
                stacked_report: [],
                signposts: [],
            },
            isLoading: false,
            error: null,
        });

        render(
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, { path: '/reports/report-a', reportName: 'report-a' }],
                    [selectedPerformanceRangeAtom, [1, 2]],
                ]}
            >
                <Performance />
            </TestProviders>,
        );

        fireEvent.click(screen.getByRole('tab', { name: 'Charts' }));

        await waitFor(() => {
            expect(getHistogramLayout()?.annotations).toHaveLength(3);
        });

        const onClickAnnotation = getHistogramInstances().at(-1)?.onClickAnnotation as
            | ((event: { index: number }) => void)
            | undefined;

        onClickAnnotation?.({ index: 0 });

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: 'Table', selected: true })).toBeInTheDocument();
        });

        const table = screen.getByRole('table');
        expect(within(table).getAllByText('Matmul').length).toBeGreaterThan(0);
        expect(within(table).queryByText('Conv2d')).not.toBeInTheDocument();

        // The histogram bins pre-duration-filter rows, so returning shows every column with one filled
        fireEvent.click(screen.getByRole('tab', { name: 'Charts' }));

        await waitFor(() => {
            expect(getHistogramLayout()?.annotations).toHaveLength(3);
        });

        const annotations = getHistogramLayout()?.annotations as { bgcolor?: string }[];
        expect(annotations.map((annotation) => annotation.bgcolor !== PERF_CHART_TRANSPARENT)).toEqual([
            true,
            false,
            false,
        ]);
    });
});
