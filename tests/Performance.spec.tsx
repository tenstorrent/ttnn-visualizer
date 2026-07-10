// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAtom, useSetAtom } from 'jotai';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Performance from '../src/routes/Performance';
import {
    useL1PressureByOperation,
    useOpToPerfIdFiltered,
    usePerfFolderList,
    usePerfMeta,
    usePerformanceComparisonReport,
    usePerformanceRange,
    usePerformanceReport,
} from '../src/hooks/useAPI';
import { activePerformanceReportAtom, selectedPerfRowIdAtom, selectedPerformanceRangeAtom } from '../src/store/app';
import { L1PressureStatus } from '../src/functions/l1Pressure';
import { PerfTableRow } from '../src/definitions/PerfTable';
import { PerfHeuristicFlag } from '../src/definitions/PerfHeuristics';
import { OpType } from '../src/definitions/Performance';
import { TestProviders } from './helpers/TestProviders';

const perfReportProps = vi.hoisted(() => vi.fn());

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useL1PressureByOperation: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
    usePerfFolderList: vi.fn(),
    usePerfMeta: vi.fn(),
    usePerformanceComparisonReport: vi.fn(),
    usePerformanceRange: vi.fn(),
    usePerformanceReport: vi.fn(),
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => ({ SERVER_MODE: true }),
}));

// Stub the report shell so these tests exercise only the route's own
// active-report effects, not PerfTable's selection cleanup effect (which would
// otherwise clear selectedPerfRowIdAtom while the skeleton is mounted).
vi.mock('../src/components/performance/PerfReport', () => ({
    default: (props: Record<string, unknown>) => {
        perfReportProps(props);
        return <div data-testid='perf-report-stub' />;
    },
}));

const DRAM_PERF_ROW = {
    id: '1',
    global_call_count: 0,
    advice: [],
    total_percent: '12.5',
    bound: 'DRAM',
    op_code: 'Matmul',
    raw_op_code: 'Matmul',
    device: '0',
    device_time: '123.4',
    op_to_op_gap: '2.5',
    cores: '64',
    dram: '15.5',
    dram_percent: '42.1',
    flops: '88.8',
    flops_percent: '73.2',
    math_fidelity: 'HiFi4',
    output_datatype: 'BFLOAT16',
    output_0_memory: '',
    input_0_datatype: 'BFLOAT16',
    input_1_datatype: 'BFLOAT16',
    dram_sharded: '',
    input_0_memory: 'DEV_0_DRAM_INTERLEAVED',
    input_1_memory: '',
    inner_dim_block_size: '',
    output_subblock_h: '',
    output_subblock_w: '',
    pm_ideal_ns: '1000',
    op_type: OpType.DEVICE_OP,
    hash: null,
    cache_hit: null,
} as unknown as PerfTableRow;

const REPORT_A = { path: '/reports/a', reportName: 'report-a' };
const REPORT_B = { path: '/reports/b', reportName: 'report-b' };
const SELECTED_ROW_ID = 100;

afterEach(cleanup);

beforeEach(() => {
    perfReportProps.mockClear();
    // Loading state: the route keeps its shell mounted (no full-page spinner) and the
    // report shell is stubbed, so only the route's active-report effects run here.
    (usePerformanceReport as Mock).mockReturnValue({ data: undefined, isLoading: true, error: null });
    (usePerformanceComparisonReport as Mock).mockReturnValue({ data: undefined });
    (usePerfFolderList as Mock).mockReturnValue({ data: undefined });
    (usePerformanceRange as Mock).mockReturnValue(null);
    (useOpToPerfIdFiltered as Mock).mockReturnValue([]);
    (useL1PressureByOperation as Mock).mockReturnValue({ status: L1PressureStatus.Unavailable, data: null });
    (usePerfMeta as Mock).mockReturnValue({ data: undefined, isLoading: false });
});

function PerformanceController() {
    const [selected, setSelected] = useAtom(selectedPerfRowIdAtom);
    const setReport = useSetAtom(activePerformanceReportAtom);

    return (
        <div>
            <span data-testid='selected-row-probe'>{selected === null ? 'null' : String(selected)}</span>
            <button
                type='button'
                data-testid='select-row'
                onClick={() => setSelected(SELECTED_ROW_ID)}
            >
                select
            </button>
            <button
                type='button'
                data-testid='set-report-a'
                onClick={() => setReport(REPORT_A)}
            >
                a
            </button>
            <button
                type='button'
                data-testid='set-report-b'
                onClick={() => setReport(REPORT_B)}
            >
                b
            </button>
        </div>
    );
}

describe('Performance route', () => {
    it('clears selectedPerfRowIdAtom when the active performance report changes', () => {
        render(
            <TestProviders>
                <Performance />
                <PerformanceController />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));

        fireEvent.click(screen.getByTestId('select-row'));
        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent(String(SELECTED_ROW_ID));

        fireEvent.click(screen.getByTestId('set-report-b'));

        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent('null');
    });

    it('does not re-clear selectedPerfRowIdAtom while the active report is unchanged', () => {
        render(
            <TestProviders>
                <Performance />
                <PerformanceController />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));
        fireEvent.click(screen.getByTestId('select-row'));
        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent(String(SELECTED_ROW_ID));

        fireEvent.click(screen.getByTestId('set-report-a'));

        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent(String(SELECTED_ROW_ID));
    });

    it('annotates enriched rows and passes perfHeuristicContext to PerfReport', () => {
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [] },
            isLoading: false,
            error: null,
        });
        (usePerformanceRange as Mock).mockReturnValue([1, 1]);

        render(
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, REPORT_A],
                    [selectedPerformanceRangeAtom, [1, 1]],
                ]}
            >
                <Performance />
            </TestProviders>,
        );

        expect(perfReportProps).toHaveBeenCalled();
        const lastProps = perfReportProps.mock.calls.at(-1)?.[0];
        expect(lastProps?.perfHeuristicContext).toEqual(expect.objectContaining({ maxCores: expect.any(Number) }));
        expect(lastProps?.data?.[0]?.heuristicFlags).toContain(PerfHeuristicFlag.DRAM_BOUND);
        expect(lastProps?.data?.[0]?.heuristicFlagDetails?.[PerfHeuristicFlag.DRAM_BOUND]).toBe('Bound: DRAM');
    });

    it('annotates comparison report rows with heuristic flags', () => {
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [] },
            isLoading: false,
            error: null,
        });
        (usePerformanceComparisonReport as Mock).mockReturnValue({
            data: [{ report: [{ ...DRAM_PERF_ROW, id: '2' }], stacked_report: [] }],
        });
        (usePerformanceRange as Mock).mockReturnValue([1, 2]);

        render(
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, REPORT_A],
                    [selectedPerformanceRangeAtom, [1, 2]],
                ]}
            >
                <Performance />
            </TestProviders>,
        );

        const lastProps = perfReportProps.mock.calls.at(-1)?.[0];
        expect(lastProps?.comparisonData?.[0]?.[0]?.heuristicFlags).toContain(PerfHeuristicFlag.DRAM_BOUND);
        expect(lastProps?.comparisonData?.[0]?.[0]?.heuristicFlagDetails?.[PerfHeuristicFlag.DRAM_BOUND]).toBe(
            'Bound: DRAM',
        );
    });
});
