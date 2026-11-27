// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { ReactNode, useEffect, useState } from 'react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Performance from '../src/routes/Performance';
import {
    useL1PressureByOperation,
    useOpToPerfIdFiltered,
    useOpToPerfIdForPerfTable,
    usePerfComparisonCandidates,
    usePerfMeta,
    usePerfMetas,
    usePerformanceComparisonReport,
    usePerformanceRange,
    usePerformanceReport,
} from '../src/hooks/useAPI';
import {
    activePerformanceReportAtom,
    bufferTypeFilterListAtom,
    comparisonPerformanceReportDirectoryAtom,
    comparisonPerformanceReportListAtom,
    durationBucketFilterListAtom,
    layoutFilterListAtom,
    mathFilterListAtom,
    opCategoryFilterListAtom,
    rawOpCodeFilterListAtom,
    selectedPerfRowIdAtom,
    selectedPerformanceRangeAtom,
} from '../src/store/app';
import { BufferType } from '../src/model/BufferType';
import { DeviceOperationLayoutTypes } from '../src/model/APIData';
import { OperationCategories } from '../src/definitions/StackedPerfTable';
import { L1PressureStatus } from '../src/model/L1Pressure';
import { TEST_IDS } from '../src/definitions/TestIds';
import { PerfTableRow } from '../src/model/PerfTable';
import { PerfHeuristicFlag } from '../src/definitions/PerfHeuristics';
import {
    COMPARISON_LOAD_FAILED_TITLE,
    OpType,
    SIGNPOST_RANGE_IGNORED_REASON,
    SIGNPOST_RANGE_IGNORED_TITLE,
} from '../src/definitions/Performance';
import { TestProviders } from './helpers/TestProviders';
import { COMPARISON_LIST_PROBE_TEST_ID, ComparisonListProbe } from './helpers/ComparisonListProbe';
import { makeAllocationFailure } from './helpers/allocationFailure';
import { useAllocationFailures } from '../src/hooks/useAllocationFailures';
import { AllocationFailure } from '../src/model/AllocationFailure';
import { useDramFallbacks } from '../src/hooks/useDramFallbacks';
import { DramFallback } from '../src/model/DramFallback';
import { makeDramFallback } from './helpers/dramFallback';

const perfReportProps = vi.hoisted(() => vi.fn());

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useL1PressureByOperation: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
    useOpToPerfIdForPerfTable: vi.fn(),
    usePerfComparisonCandidates: vi.fn(),
    usePerfMeta: vi.fn(),
    usePerfMetas: vi.fn(),
    usePerformanceComparisonReport: vi.fn(),
    usePerformanceRange: vi.fn(),
    usePerformanceReport: vi.fn(),
}));

vi.mock('../src/hooks/useAllocationFailures', () => ({
    useAllocationFailures: vi.fn(),
}));

vi.mock('../src/hooks/useDramFallbacks', () => ({
    useDramFallbacks: vi.fn(),
}));

const serverConfig = vi.hoisted(() => ({ SERVER_MODE: true }));

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => serverConfig,
    isFlagEnabled: (value: unknown) => value === true || value === 'true' || value === '1',
}));

// Only rendered once SERVER_MODE is off; its picker reads hooks this spec does not mock.
vi.mock('../src/components/performance/ComparisonReportSelector', () => ({
    default: ({ folderList, directory }: { folderList: unknown[]; directory: string | null }) => (
        <div
            data-testid={TEST_IDS.COMPARISON_REPORT_SELECTOR}
            data-folder-count={folderList.length}
            data-directory={directory ?? ''}
        />
    ),
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
const MATH_FIDELITY = 'HiFi4';
const DURATION_BUCKET_MIN_US = 100;

afterEach(cleanup);

beforeEach(() => {
    perfReportProps.mockClear();
    // Loading state: the route keeps its shell mounted (no full-page spinner) and the
    // report shell is stubbed, so only the route's active-report effects run here.
    (usePerformanceReport as Mock).mockReturnValue({ data: undefined, isLoading: true, error: null });
    (usePerformanceComparisonReport as Mock).mockReturnValue({ data: undefined });
    (usePerfComparisonCandidates as Mock).mockReturnValue({ data: undefined });
    serverConfig.SERVER_MODE = true;
    (usePerformanceRange as Mock).mockReturnValue(null);
    (useOpToPerfIdFiltered as Mock).mockReturnValue([]);
    // Devices are merged unless a test says otherwise, where the table's lookup is the linked one.
    (useOpToPerfIdForPerfTable as Mock).mockImplementation(() => (useOpToPerfIdFiltered as Mock)());
    (useL1PressureByOperation as Mock).mockReturnValue({ status: L1PressureStatus.Unavailable, data: null });
    (usePerfMeta as Mock).mockReturnValue({ data: undefined, isLoading: false });
    (usePerfMetas as Mock).mockReturnValue([]);
    (useAllocationFailures as Mock).mockReturnValue({
        listings: [],
        allocationFailureByOpId: new Map<number, AllocationFailure>(),
    });
    (useDramFallbacks as Mock).mockReturnValue(new Map<number, DramFallback>());
});

function formatFilterProbe(values: unknown[]): string {
    return values.length === 0 ? 'empty' : values.join(',');
}

function PerformanceController() {
    const [selected, setSelected] = useAtom(selectedPerfRowIdAtom);
    const [rawOpCodeFilterList, setRawOpCodeFilterList] = useAtom(rawOpCodeFilterListAtom);
    const [mathFilterList, setMathFilterList] = useAtom(mathFilterListAtom);
    const [bufferTypeFilterList, setBufferTypeFilterList] = useAtom(bufferTypeFilterListAtom);
    const [layoutFilterList, setLayoutFilterList] = useAtom(layoutFilterListAtom);
    const [opCategoryFilterList, setOpCategoryFilterList] = useAtom(opCategoryFilterListAtom);
    const [durationBucketFilterList, setDurationBucketFilterList] = useAtom(durationBucketFilterListAtom);
    const setReport = useSetAtom(activePerformanceReportAtom);

    return (
        <div>
            <span data-testid='selected-row-probe'>{selected === null ? 'null' : String(selected)}</span>
            <span data-testid='raw-op-code-filter-probe'>{formatFilterProbe(rawOpCodeFilterList)}</span>
            <span data-testid='math-filter-probe'>{formatFilterProbe(mathFilterList)}</span>
            <span data-testid='buffer-type-filter-probe'>{formatFilterProbe(bufferTypeFilterList)}</span>
            <span data-testid='layout-filter-probe'>{formatFilterProbe(layoutFilterList)}</span>
            <span data-testid='op-category-filter-probe'>{formatFilterProbe(opCategoryFilterList)}</span>
            <span data-testid='duration-bucket-filter-probe'>{formatFilterProbe(durationBucketFilterList)}</span>
            <button
                type='button'
                data-testid='select-row'
                onClick={() => setSelected(SELECTED_ROW_ID)}
            >
                select
            </button>
            <button
                type='button'
                data-testid='set-all-filters'
                onClick={() => {
                    setRawOpCodeFilterList(['Matmul']);
                    setMathFilterList([MATH_FIDELITY]);
                    setBufferTypeFilterList([BufferType.L1]);
                    setLayoutFilterList([DeviceOperationLayoutTypes.INTERLEAVED]);
                    setOpCategoryFilterList([OperationCategories.CCL]);
                    setDurationBucketFilterList([DURATION_BUCKET_MIN_US]);
                }}
            >
                filter
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

    it('annotates enriched rows and passes maxCores to PerfReport', () => {
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
        expect(lastProps?.maxCores).toEqual(expect.any(Number));
        expect(lastProps?.data?.[0]?.heuristicFlags).toContain(PerfHeuristicFlag.DRAM_BOUND);
        expect(lastProps?.data?.[0]?.heuristicFlagDetails?.[PerfHeuristicFlag.DRAM_BOUND]).toBe('Bound: DRAM');
    });

    it('uses perfRange when selectedRange is not yet synced so the table does not flash empty', () => {
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
                    // selectedPerformanceRangeAtom defaults to null — the gap before RangeSlider syncs.
                ]}
            >
                <Performance />
            </TestProviders>,
        );

        const lastProps = perfReportProps.mock.calls.at(-1)?.[0];
        expect(lastProps?.isLoading).toBe(false);
        expect(lastProps?.data).toHaveLength(1);
        expect(lastProps?.data?.[0]?.heuristicFlags).toContain(PerfHeuristicFlag.DRAM_BOUND);
    });

    // The other half of `clampSelectionToRange`'s widen contract. Op<->perf ids now
    // resolve against the link-pinned report while this table spans the rows the tab
    // is showing, so a mapped selection can land entirely outside the report — here
    // it must fall back to the full span rather than render an empty table.
    //
    // The range has to have width for this to pin anything: over a zero-width range
    // the widen branch and the clamp branch both return that single id, so the
    // assertion could not tell them apart. With [1, 9] and two rows, widening keeps
    // both and clamping to the far edge would keep one.
    it('falls back to the whole report when the selected range misses it entirely', () => {
        (usePerformanceReport as Mock).mockReturnValue({
            data: {
                report: [DRAM_PERF_ROW, { ...DRAM_PERF_ROW, id: '9' }],
                stacked_report: [],
                signposts: [],
            },
            isLoading: false,
            error: null,
        });
        (usePerformanceRange as Mock).mockReturnValue([1, 9]);

        render(
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, REPORT_A],
                    // Left over from a signpost window that does not overlap this report.
                    [selectedPerformanceRangeAtom, [40, 50]],
                ]}
            >
                <Performance />
            </TestProviders>,
        );

        expect(perfReportProps.mock.calls.at(-1)?.[0]?.data).toHaveLength(2);
    });

    it('keeps the table loading while report rows exist but no range is available yet', () => {
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [] },
            isLoading: false,
            error: null,
        });
        (usePerformanceRange as Mock).mockReturnValue(null);

        render(
            <TestProviders initialAtomValues={[[activePerformanceReportAtom, REPORT_A]]}>
                <Performance />
            </TestProviders>,
        );

        const lastProps = perfReportProps.mock.calls.at(-1)?.[0];
        expect(lastProps?.isLoading).toBe(true);
        expect(lastProps?.data).toHaveLength(0);
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
        (usePerfMetas as Mock).mockReturnValue([{ max_cores: 130, architecture: null, frequency: null }]);

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
        expect(lastProps?.comparisonMaxCores).toEqual([130]);
    });

    it.each([
        { holder: 'the primary report alone', primary: true, comparison: false, expected: true },
        { holder: 'a comparison report alone', primary: false, comparison: true, expected: true },
        { holder: 'neither report', primary: false, comparison: false, expected: false },
    ])('reads hardware counters as $expected when $holder has them', ({ primary, comparison, expected }) => {
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [], has_hardware_counters: primary },
            isLoading: false,
            error: null,
        });
        (usePerformanceComparisonReport as Mock).mockReturnValue({
            data: [{ report: [{ ...DRAM_PERF_ROW, id: '2' }], stacked_report: [], has_hardware_counters: comparison }],
        });
        (usePerformanceRange as Mock).mockReturnValue([1, 2]);
        (usePerfMetas as Mock).mockReturnValue([null]);

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

        expect(perfReportProps.mock.calls.at(-1)?.[0]?.hasHardwareCounters).toBe(expected);
    });

    it('announces each comparison report that could not be loaded, keeping the rest', () => {
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [] },
            isLoading: false,
            error: null,
        });
        (usePerformanceComparisonReport as Mock).mockReturnValue({
            data: [{ report: [{ ...DRAM_PERF_ROW, id: '2' }], stacked_report: [] }, null],
            isLoading: false,
            failures: [new Error("report-c: no signpost named 'PERF_DECODE' in this report")],
        });
        (usePerformanceRange as Mock).mockReturnValue([1, 1]);
        (usePerfMetas as Mock).mockReturnValue([null, null]);

        render(
            <TestProviders initialAtomValues={[[activePerformanceReportAtom, REPORT_A]]}>
                <Performance />
            </TestProviders>,
        );

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(COMPARISON_LOAD_FAILED_TITLE);
        expect(alert).toHaveTextContent("report-c: no signpost named 'PERF_DECODE' in this report");
        // The report that loaded keeps its rows; the one that did not keeps its slot.
        const comparisonData = perfReportProps.mock.calls.at(-1)?.[0]?.comparisonData;
        expect(comparisonData).toHaveLength(2);
        expect(comparisonData[0]).toHaveLength(1);
        expect(comparisonData[1]).toEqual([]);
    });

    it('names each report shown whole because it holds no signposts for the range', () => {
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [], signpost_range_ignored: false },
            isLoading: false,
            error: null,
        });
        (usePerformanceComparisonReport as Mock).mockReturnValue({
            data: [
                { report: [DRAM_PERF_ROW], stacked_report: [], signpost_range_ignored: true },
                { report: [DRAM_PERF_ROW], stacked_report: [], signpost_range_ignored: false },
            ],
            isLoading: false,
            failures: [],
        });
        (usePerformanceRange as Mock).mockReturnValue([1, 1]);
        (usePerfMetas as Mock).mockReturnValue([null, null]);

        render(
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, REPORT_A],
                    [comparisonPerformanceReportListAtom, ['report-b', 'report-c']],
                ]}
            >
                <Performance />
            </TestProviders>,
        );

        const notice = screen.getByRole('status');
        expect(notice).toHaveTextContent(SIGNPOST_RANGE_IGNORED_TITLE);
        expect(notice).toHaveTextContent(`report-b ${SIGNPOST_RANGE_IGNORED_REASON}`);
        expect(notice).not.toHaveTextContent('report-c');
    });

    it.each([
        {
            source: 'a local pick',
            report: { path: 'report-b', reportName: 'report-b' },
            comparisons: ['report-b', 'report-c'],
            remaining: ['report-c'],
        },
        // A fresh remote pick holds the remote path; its folder id is the synced name. On a
        // multihost rank the display name has no rank, so it names a different report.
        {
            source: 'a fresh remote pick',
            report: { path: '/remote/reports/run', reportName: 'run', syncedName: 'run_rank1' },
            comparisons: ['run_rank1', 'run'],
            remaining: ['run'],
        },
    ])('drops the active report from the comparisons when it is $source', ({ report, comparisons, remaining }) => {
        render(
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, report],
                    [comparisonPerformanceReportListAtom, comparisons],
                ]}
            >
                <Performance />
                <ComparisonListProbe />
            </TestProviders>,
        );

        expect(screen.getByTestId(COMPARISON_LIST_PROBE_TEST_ID)).toHaveTextContent(JSON.stringify(remaining));
    });

    it('drops a comparison when the user switches the active report to it', () => {
        const remotePick = { path: '/remote/reports/run', reportName: 'run', syncedName: 'run_rank1' };

        function SwitchToRemotePick() {
            const setReport = useSetAtom(activePerformanceReportAtom);

            return (
                <button
                    type='button'
                    onClick={() => setReport(remotePick)}
                >
                    Switch to the remote pick
                </button>
            );
        }

        render(
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, REPORT_A],
                    [comparisonPerformanceReportListAtom, ['run_rank1', 'run']],
                ]}
            >
                <Performance />
                <SwitchToRemotePick />
                <ComparisonListProbe />
            </TestProviders>,
        );

        const probe = screen.getByTestId(COMPARISON_LIST_PROBE_TEST_ID);
        expect(probe).toHaveTextContent('["run_rank1","run"]');

        fireEvent.click(screen.getByRole('button', { name: 'Switch to the remote pick' }));

        expect(probe).toHaveTextContent('["run"]');
    });

    describe("comparisons the active report's directory no longer lists (#2433)", () => {
        const LISTED_DIRECTORY = '/reports';
        const candidates = (...names: string[]) => names.map((name) => ({ path: name, reportName: name }));
        // A listing fetched for this visit unless a test says otherwise.
        const listing = (
            reports: ReturnType<typeof candidates> | null,
            {
                directory = LISTED_DIRECTORY,
                isSuccess = true,
                isFetching = false,
                isFetchedAfterMount = true,
            }: { directory?: string; isSuccess?: boolean; isFetching?: boolean; isFetchedAfterMount?: boolean } = {},
        ) => ({
            data: { directory, reports },
            isSuccess,
            isError: !isSuccess,
            isFetching,
            isFetchedAfterMount,
        });

        const comparisonTree = (comparisons: string[], pickedFrom = LISTED_DIRECTORY, extra: ReactNode = null) => (
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, REPORT_A],
                    [comparisonPerformanceReportListAtom, comparisons],
                    [comparisonPerformanceReportDirectoryAtom, pickedFrom],
                ]}
            >
                <Performance />
                <ComparisonListProbe />
                {extra}
            </TestProviders>
        );

        const probedComparisons = () => screen.getByTestId(COMPARISON_LIST_PROBE_TEST_ID);

        it('keeps only the comparisons still listed beside the active report', () => {
            (usePerfComparisonCandidates as Mock).mockReturnValue(listing(candidates('a', 'report-b', 'c')));

            render(comparisonTree(['report-b', 'elsewhere', 'c']));

            expect(probedComparisons()).toHaveTextContent('["report-b","c"]');
        });

        it('clears the comparisons when none of them is listed', () => {
            (usePerfComparisonCandidates as Mock).mockReturnValue(listing(candidates('a')));

            render(comparisonTree(['elsewhere']));

            expect(probedComparisons()).toHaveTextContent('null');
        });

        it.each([
            ['loading', { data: undefined, isSuccess: false, isError: false, isFetching: true }],
            ['failed', { data: undefined, isSuccess: false, isError: true, isFetching: false }],
        ])('keeps every comparison while the listing is %s', (_state, result) => {
            (usePerfComparisonCandidates as Mock).mockReturnValue(result);

            render(comparisonTree(['report-b', 'c']));

            expect(probedComparisons()).toHaveTextContent('["report-b","c"]');
        });

        // Paused is the offline case: no request goes out, so only `isFetchedAfterMount` tells
        // the cached listing from a current one.
        it.each([
            ['refetches', true],
            ['is paused', false],
        ])('keeps the comparisons while a cached listing from an earlier visit %s', (_state, isFetching) => {
            (usePerfComparisonCandidates as Mock).mockReturnValue(
                listing(candidates('a'), { isFetching, isFetchedAfterMount: false }),
            );

            render(comparisonTree(['added-since']));

            expect(probedComparisons()).toHaveTextContent('["added-since"]');
        });

        it('keeps the comparisons when their directory is searchable but cannot be listed', () => {
            (usePerfComparisonCandidates as Mock).mockReturnValue(listing(null));

            render(comparisonTree(['report-b']));

            expect(probedComparisons()).toHaveTextContent('["report-b"]');
        });

        it('drops comparisons picked elsewhere even when the new directory cannot be listed', () => {
            (usePerfComparisonCandidates as Mock).mockReturnValue(listing(null, { directory: '/tmp/runs' }));

            render(comparisonTree(['shared-name']));

            expect(probedComparisons()).toHaveTextContent('null');
        });

        it('keeps the comparisons when the refetch of a cached listing fails', () => {
            (usePerfComparisonCandidates as Mock).mockReturnValue(listing(candidates('a'), { isSuccess: false }));

            render(comparisonTree(['added-since']));

            expect(probedComparisons()).toHaveTextContent('["added-since"]');
        });

        it('still shows the selectors when no listing could be read, so the picks can be removed', () => {
            // Comparison is local-only.
            serverConfig.SERVER_MODE = false;
            (usePerformanceReport as Mock).mockReturnValue({
                data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [] },
                isLoading: false,
                error: null,
            });
            (usePerfComparisonCandidates as Mock).mockReturnValue({
                data: undefined,
                isSuccess: false,
                isError: true,
                isFetching: false,
            });

            render(comparisonTree(['report-b']));

            const selectors = screen.getAllByTestId(TEST_IDS.COMPARISON_REPORT_SELECTOR);
            expect(selectors.length).toBeGreaterThan(0);
            expect(selectors[0]).toHaveAttribute('data-folder-count', '0');
        });

        it('drops comparisons once a switch to another directory lists different reports', () => {
            (usePerfComparisonCandidates as Mock).mockReturnValue(listing(candidates('a', 'report-b')));
            const { rerender } = render(comparisonTree(['report-b']));
            expect(probedComparisons()).toHaveTextContent('["report-b"]');

            (usePerfComparisonCandidates as Mock).mockReturnValue(
                listing(candidates('synced-a', 'synced-b'), { directory: '/synced/remote-host' }),
            );
            rerender(comparisonTree(['report-b']));

            expect(probedComparisons()).toHaveTextContent('null');
        });

        it('drops a comparison picked in another directory even when this one has a namesake', () => {
            (usePerfComparisonCandidates as Mock).mockReturnValue(
                listing(candidates('a', 'shared-name'), { directory: '/synced/remote-host' }),
            );

            render(comparisonTree(['shared-name', 'local-only']));

            expect(probedComparisons()).toHaveTextContent('null');
        });

        it('never holds the active report as its own comparison while pruning', () => {
            const history: (string[] | null)[] = [];
            function HistoryProbe() {
                const comparisons = useAtomValue(comparisonPerformanceReportListAtom);
                useEffect(() => {
                    history.push(comparisons);
                }, [comparisons]);
                return null;
            }
            (usePerfComparisonCandidates as Mock).mockReturnValue(listing(candidates('a', 'report-b')));

            render(comparisonTree(['a', 'gone'], LISTED_DIRECTORY, <HistoryProbe />));

            // Two writes from one render would pass through `["a"]` on the way.
            expect(history).toEqual([['a', 'gone'], null]);
        });
    });

    it('shows no signpost notice when every report was narrowed', () => {
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [], signpost_range_ignored: false },
            isLoading: false,
            error: null,
        });
        (usePerformanceComparisonReport as Mock).mockReturnValue({ data: undefined, isLoading: false, failures: [] });
        (usePerformanceRange as Mock).mockReturnValue([1, 1]);

        render(
            <TestProviders initialAtomValues={[[activePerformanceReportAtom, REPORT_A]]}>
                <Performance />
            </TestProviders>,
        );

        expect(screen.queryByTestId(TEST_IDS.PERF_SIGNPOST_RANGE_IGNORED)).not.toBeInTheDocument();
    });

    it('shows no comparison error when the comparisons load', () => {
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [] },
            isLoading: false,
            error: null,
        });
        (usePerformanceComparisonReport as Mock).mockReturnValue({ data: undefined, isLoading: false, failures: [] });
        (usePerformanceRange as Mock).mockReturnValue([1, 1]);

        render(
            <TestProviders initialAtomValues={[[activePerformanceReportAtom, REPORT_A]]}>
                <Performance />
            </TestProviders>,
        );

        expect(screen.queryByTestId(TEST_IDS.PERF_COMPARISON_ERROR)).not.toBeInTheDocument();
    });

    it('marks active rows with their linked failure, lists it, and leaves comparison rows unmarked', () => {
        const failure = makeAllocationFailure({ operationId: 7 });
        const listings = [
            { failure, failedDeviceOperations: ['Conv2d'], ranDeviceOperationCount: 1, linkedRowCount: 1 },
        ];

        (useAllocationFailures as Mock).mockReturnValue({
            listings,
            allocationFailureByOpId: new Map([[7, failure]]),
        });
        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ perfId: '1', opId: 7 }]);
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [] },
            isLoading: false,
            error: null,
        });
        // Same perf id, so the op-id lookup resolves for the comparison row too: only the
        // null failure map keeps the active report's failure off it.
        (usePerformanceComparisonReport as Mock).mockReturnValue({
            data: [{ report: [DRAM_PERF_ROW], stacked_report: [] }],
        });
        (usePerformanceRange as Mock).mockReturnValue([1, 1]);
        (usePerfMetas as Mock).mockReturnValue([{ max_cores: 130, architecture: null, frequency: null }]);

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

        const lastProps = perfReportProps.mock.calls.at(-1)?.[0];
        const [activeRow] = lastProps?.data ?? [];
        const [comparisonRow] = lastProps?.comparisonData?.[0] ?? [];

        expect(lastProps?.allocationFailureListings).toBe(listings);
        expect(activeRow?.allocation_failure).toBe(failure);
        expect(activeRow?.heuristicFlags).toContain(PerfHeuristicFlag.ALLOCATION_FAILURE);
        expect(comparisonRow?.op).toBe(7);
        expect(comparisonRow?.allocation_failure).toBeNull();
        expect(comparisonRow?.heuristicFlags).not.toContain(PerfHeuristicFlag.ALLOCATION_FAILURE);
    });

    it('flags active rows with their linked DRAM fallback and leaves comparison rows unflagged', () => {
        const fallback = makeDramFallback({ operationId: 7 });

        (useDramFallbacks as Mock).mockReturnValue(new Map([[7, fallback]]));
        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ perfId: '1', opId: 7 }]);
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [] },
            isLoading: false,
            error: null,
        });
        // Same perf id, so the op-id lookup resolves for the comparison row too: only the
        // null linked data keeps the active report's fallback off it.
        (usePerformanceComparisonReport as Mock).mockReturnValue({
            data: [{ report: [DRAM_PERF_ROW], stacked_report: [] }],
        });
        (usePerformanceRange as Mock).mockReturnValue([1, 1]);
        (usePerfMetas as Mock).mockReturnValue([{ max_cores: 130, architecture: null, frequency: null }]);

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

        const lastProps = perfReportProps.mock.calls.at(-1)?.[0];
        const [activeRow] = lastProps?.data ?? [];
        const [comparisonRow] = lastProps?.comparisonData?.[0] ?? [];

        expect(activeRow?.dram_fallback).toBe(fallback);
        expect(activeRow?.heuristicFlags).toContain(PerfHeuristicFlag.DRAM_FALLBACK);
        expect(comparisonRow?.op).toBe(7);
        expect(comparisonRow?.dram_fallback).toBeNull();
        expect(comparisonRow?.heuristicFlags).not.toContain(PerfHeuristicFlag.DRAM_FALLBACK);
    });

    // #2084: with devices unmerged, each device's row of a linked operation carries the same
    // op-joined data. The comparison report keeps the merged lookup.
    it('joins every per-device row of an unmerged operation through the table lookup', () => {
        const failure = makeAllocationFailure({ operationId: 7 });
        const fallback = makeDramFallback({ operationId: 7 });
        const l1Pressure = { fullnessPercent: 87.5, freeSegments: 3, largestFreeBytes: 1024, largestFreePercent: 12.5 };
        const deviceRows = [DRAM_PERF_ROW, { ...DRAM_PERF_ROW, id: '2', device: '1' }];

        (useAllocationFailures as Mock).mockReturnValue({
            listings: [],
            allocationFailureByOpId: new Map([[7, failure]]),
        });
        (useDramFallbacks as Mock).mockReturnValue(new Map([[7, fallback]]));
        (useL1PressureByOperation as Mock).mockReturnValue({
            status: L1PressureStatus.Ready,
            data: new Map([[7, l1Pressure]]),
        });
        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ perfId: '1', opId: 7 }]);
        (useOpToPerfIdForPerfTable as Mock).mockReturnValue([
            { perfId: '1', opId: 7 },
            { perfId: '2', opId: 7 },
        ]);
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: deviceRows, stacked_report: [], signposts: [] },
            isLoading: false,
            error: null,
        });
        (usePerformanceComparisonReport as Mock).mockReturnValue({
            data: [{ report: deviceRows, stacked_report: [] }],
        });
        (usePerformanceRange as Mock).mockReturnValue([1, 2]);
        (usePerfMetas as Mock).mockReturnValue([{ max_cores: 130, architecture: null, frequency: null }]);

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
        const activeRows = lastProps?.data ?? [];

        expect(activeRows).toHaveLength(2);

        for (const activeRow of activeRows) {
            expect(activeRow.op).toBe(7);
            expect(activeRow.allocation_failure).toBe(failure);
            expect(activeRow.dram_fallback).toBe(fallback);
            expect(activeRow.l1_fullness_percent).toBe(l1Pressure.fullnessPercent);
            expect(activeRow.l1_free_segments).toBe(l1Pressure.freeSegments);
            expect(activeRow.l1_largest_free).toBe(l1Pressure.largestFreeBytes);
            expect(activeRow.l1_largest_free_percent).toBe(l1Pressure.largestFreePercent);
            expect(activeRow.heuristicFlags).toContain(PerfHeuristicFlag.ALLOCATION_FAILURE);
            expect(activeRow.heuristicFlags).toContain(PerfHeuristicFlag.DRAM_FALLBACK);
        }

        expect(lastProps?.comparisonData?.[0]?.map((row: { op?: number }) => row.op)).toEqual([7, undefined]);
    });

    // #2084: the hook is mocked, so only this ties the failure row count to the table's lookup
    // rather than the merged one.
    it('counts allocation-failure rows through the table lookup', () => {
        const perfTableOpIdsMap = [
            { perfId: '1', opId: 7 },
            { perfId: '2', opId: 7 },
        ];

        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ perfId: '1', opId: 7 }]);
        (useOpToPerfIdForPerfTable as Mock).mockReturnValue(perfTableOpIdsMap);

        render(
            <TestProviders>
                <Performance />
            </TestProviders>,
        );

        expect(useAllocationFailures).toHaveBeenCalledWith(perfTableOpIdsMap);
    });

    // Source line judges availability on the whole report's links, not the range's rows.
    it.each([
        { opIds: [], expected: false },
        { opIds: [{ perfId: '9', opId: 7 }], expected: true },
    ])('passes hasLinkedOperations as $expected from the table lookup', ({ opIds, expected }) => {
        (usePerformanceReport as Mock).mockReturnValue({
            data: { report: [DRAM_PERF_ROW], stacked_report: [], signposts: [] },
            isLoading: false,
            error: null,
        });
        (useOpToPerfIdForPerfTable as Mock).mockReturnValue(opIds);

        render(
            <TestProviders initialAtomValues={[[activePerformanceReportAtom, REPORT_A]]}>
                <Performance />
            </TestProviders>,
        );

        expect(perfReportProps.mock.calls.at(-1)?.[0].hasLinkedOperations).toBe(expected);
    });

    // Both hooks are mocked, so only this ties the retry signal to the failures the route parsed.
    it('detects DRAM fallbacks against the allocation failures it already parsed', () => {
        const allocationFailureByOpId = new Map([[7, makeAllocationFailure({ operationId: 7 })]]);

        (useAllocationFailures as Mock).mockReturnValue({ listings: [], allocationFailureByOpId });

        render(
            <TestProviders>
                <Performance />
            </TestProviders>,
        );

        expect(useDramFallbacks).toHaveBeenCalledWith(allocationFailureByOpId);
    });

    it('clears all table chip filters when the active performance report changes', () => {
        render(
            <TestProviders>
                <Performance />
                <PerformanceController />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));
        fireEvent.click(screen.getByTestId('set-all-filters'));
        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('Matmul');
        expect(screen.getByTestId('math-filter-probe')).toHaveTextContent(MATH_FIDELITY);
        expect(screen.getByTestId('buffer-type-filter-probe')).toHaveTextContent(String(BufferType.L1));
        expect(screen.getByTestId('layout-filter-probe')).toHaveTextContent(DeviceOperationLayoutTypes.INTERLEAVED);
        expect(screen.getByTestId('op-category-filter-probe')).toHaveTextContent(OperationCategories.CCL);
        expect(screen.getByTestId('duration-bucket-filter-probe')).toHaveTextContent(String(DURATION_BUCKET_MIN_US));

        fireEvent.click(screen.getByTestId('set-report-b'));

        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('empty');
        expect(screen.getByTestId('math-filter-probe')).toHaveTextContent('empty');
        expect(screen.getByTestId('buffer-type-filter-probe')).toHaveTextContent('empty');
        expect(screen.getByTestId('layout-filter-probe')).toHaveTextContent('empty');
        expect(screen.getByTestId('op-category-filter-probe')).toHaveTextContent('empty');
        expect(screen.getByTestId('duration-bucket-filter-probe')).toHaveTextContent('empty');
    });

    it('does not re-clear table chip filters while the active report is unchanged', () => {
        render(
            <TestProviders>
                <Performance />
                <PerformanceController />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));
        fireEvent.click(screen.getByTestId('set-all-filters'));
        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('Matmul');
        expect(screen.getByTestId('math-filter-probe')).toHaveTextContent(MATH_FIDELITY);

        fireEvent.click(screen.getByTestId('set-report-a'));

        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('Matmul');
        expect(screen.getByTestId('math-filter-probe')).toHaveTextContent(MATH_FIDELITY);
        expect(screen.getByTestId('buffer-type-filter-probe')).toHaveTextContent(String(BufferType.L1));
        expect(screen.getByTestId('layout-filter-probe')).toHaveTextContent(DeviceOperationLayoutTypes.INTERLEAVED);
        expect(screen.getByTestId('op-category-filter-probe')).toHaveTextContent(OperationCategories.CCL);
        expect(screen.getByTestId('duration-bucket-filter-probe')).toHaveTextContent(String(DURATION_BUCKET_MIN_US));
    });

    it('does not clear table chip filters on Performance remount with the same report', () => {
        function RemountHarness() {
            const [routeKey, setRouteKey] = useState(0);

            return (
                <>
                    <Performance key={routeKey} />
                    <PerformanceController />
                    <button
                        type='button'
                        data-testid='remount-performance'
                        onClick={() => setRouteKey((key) => key + 1)}
                    >
                        remount
                    </button>
                </>
            );
        }

        render(
            <TestProviders>
                <RemountHarness />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));
        fireEvent.click(screen.getByTestId('set-all-filters'));
        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('Matmul');

        fireEvent.click(screen.getByTestId('remount-performance'));

        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('Matmul');
        expect(screen.getByTestId('math-filter-probe')).toHaveTextContent(MATH_FIDELITY);
        expect(screen.getByTestId('buffer-type-filter-probe')).toHaveTextContent(String(BufferType.L1));
        expect(screen.getByTestId('layout-filter-probe')).toHaveTextContent(DeviceOperationLayoutTypes.INTERLEAVED);
        expect(screen.getByTestId('op-category-filter-probe')).toHaveTextContent(OperationCategories.CCL);
        expect(screen.getByTestId('duration-bucket-filter-probe')).toHaveTextContent(String(DURATION_BUCKET_MIN_US));
    });

    it('does not clear selectedPerfRowIdAtom on Performance remount with the same report', () => {
        function RemountHarness() {
            const [routeKey, setRouteKey] = useState(0);

            return (
                <>
                    <Performance key={routeKey} />
                    <PerformanceController />
                    <button
                        type='button'
                        data-testid='remount-performance'
                        onClick={() => setRouteKey((key) => key + 1)}
                    >
                        remount
                    </button>
                </>
            );
        }

        render(
            <TestProviders>
                <RemountHarness />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));
        fireEvent.click(screen.getByTestId('select-row'));
        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent(String(SELECTED_ROW_ID));

        fireEvent.click(screen.getByTestId('remount-performance'));

        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent(String(SELECTED_ROW_ID));
    });
});
