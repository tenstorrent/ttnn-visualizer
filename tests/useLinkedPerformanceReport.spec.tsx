// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Whether two reports come from the same run is a property of the reports, so
 * the fetch that decides it must not follow the performance tab's view filters
 * (#1812). Merge devices in particular returns roughly one row per device, which
 * the positional match can never line up against the memory report.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider, createStore, useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGetDeviceOperationListPerf, useLinkedPerformanceReport, usePerformanceReport } from '../src/hooks/useAPI';
import {
    activePerformanceReportAtom,
    activePerformanceReportFolderNameAtom,
    activeProfilerReportAtom,
    filterBySignpostAtom,
    hideHostOpsAtom,
    mergeDevicesAtom,
    stackedGroupByAtom,
    tracingModeAtom,
} from '../src/store/app';
import { StackedGroupBy } from '../src/definitions/StackedPerfTable';
import { AtomProvider, type AtomProviderInitialValues } from './helpers/atomProvider';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
}));

const REPORT_NAME = '2026_08_14_10_00_00';
const ACTIVE_REPORT = { path: REPORT_NAME, reportName: REPORT_NAME };
const SIGNPOST = { id: 42, op_code: 'BEGIN_TRACE' };

/** Every view filter turned away from its default at once. */
const FILTERED_VIEW: AtomProviderInitialValues = [
    [mergeDevicesAtom, false],
    [hideHostOpsAtom, false],
    [filterBySignpostAtom, [SIGNPOST, null]],
];

interface RequestParams {
    name: string;
    hide_host_ops: boolean;
    merge_devices: boolean;
    tracing_mode: boolean;
    group_by: StackedGroupBy;
    start_signpost?: string;
    end_signpost?: string;
}

const getReportRequests = (): RequestParams[] =>
    vi
        .mocked(axiosInstance.get)
        .mock.calls.filter(([url]) => String(url).includes('perf-results/report'))
        .map(([, config]) => (config as { params: RequestParams }).params);

const useBothReports = () => {
    const name = useAtomValue(activePerformanceReportFolderNameAtom);

    return [usePerformanceReport(name), useLinkedPerformanceReport()];
};

// A fresh client per test: `staleTime: Infinity` would otherwise let one test's
// cached report answer the next test's request, hiding a refetch.
const renderWithView = <T,>(hook: () => T, view: AtomProviderInitialValues = []) => {
    const queryClient = new QueryClient();

    return renderHook(hook, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <AtomProvider initialValues={[[activePerformanceReportAtom, ACTIVE_REPORT], ...view]}>
                    {children}
                </AtomProvider>
            </QueryClientProvider>
        ),
    });
};

/** The same wiring against a live store, so a view filter can be changed mid-test. */
const renderWithStore = <T,>(hook: () => T, store: ReturnType<typeof createStore>) => {
    const queryClient = new QueryClient();

    store.set(activePerformanceReportAtom, ACTIVE_REPORT);

    return renderHook(hook, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axiosInstance.get).mockResolvedValue({ data: { report: [], stacked_report: [], signposts: [] } });
});

describe('useLinkedPerformanceReport', () => {
    it('asks for the whole run with devices merged and host ops hidden, whatever the tab is showing', async () => {
        renderWithView(() => useLinkedPerformanceReport(), FILTERED_VIEW);

        await waitFor(() => expect(getReportRequests()).toHaveLength(1));

        expect(getReportRequests()[0]).toMatchObject({
            name: REPORT_NAME,
            merge_devices: true,
            hide_host_ops: true,
        });
        expect(getReportRequests()[0].start_signpost).toBeUndefined();
        expect(getReportRequests()[0].end_signpost).toBeUndefined();
    });

    it('still follows tracing mode, which only reorders rows', async () => {
        renderWithView(() => useLinkedPerformanceReport(), [[tracingModeAtom, true]]);

        await waitFor(() => expect(getReportRequests()).toHaveLength(1));

        expect(getReportRequests()[0].tracing_mode).toBe(true);
    });

    it('shares the performance tab request while the tab is at its defaults', async () => {
        renderWithView(useBothReports);

        await waitFor(() => expect(getReportRequests().length).toBeGreaterThan(0));

        expect(getReportRequests()).toHaveLength(1);
    });

    it('keeps the report it has when the tab switches its stacked grouping', async () => {
        // Grouping cannot change `report`, but it is part of the query key, so
        // following it would move the link query to a fresh key — no data, and
        // the badge blanking to PENDING — on a control that reshapes only the
        // stacked chart.
        const store = createStore();
        const { result } = renderWithStore(useBothReports, store);

        await waitFor(() => expect(result.current[1].data).toBeDefined());

        act(() => store.set(stackedGroupByAtom, StackedGroupBy.MEMORY));

        expect(result.current[1].data).toBeDefined();
        expect(result.current[1].isFetching).toBe(false);

        await waitFor(() => expect(getReportRequests().at(-1)?.group_by).toBe(StackedGroupBy.MEMORY));
    });

    it('fetches separately once a view filter is applied, leaving the tab request filtered', async () => {
        renderWithView(useBothReports, FILTERED_VIEW);

        await waitFor(() => expect(getReportRequests()).toHaveLength(2));

        expect(getReportRequests()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ merge_devices: false, hide_host_ops: false, start_signpost: 'BEGIN_TRACE' }),
                expect.objectContaining({ merge_devices: true, hide_host_ops: true }),
            ]),
        );
    });
});

const DEVICE_OP_NAMES = ['Matmul', 'Softmax'];
const NUM_DEVICES = 2;

const perfRow = (id: number, rawOpCode: string) => ({ id: String(id), raw_op_code: rawOpCode, device_time: '100' });

/** One row per operation — the shape the memory report's op sequence lines up with. */
const mergedRows = DEVICE_OP_NAMES.map((name, index) => perfRow(index + 2, name));

/** The same run with devices unmerged: each operation appears once per device. */
const unmergedRows = DEVICE_OP_NAMES.flatMap((name, index) =>
    Array.from({ length: NUM_DEVICES }, (_, device) => perfRow(index * NUM_DEVICES + device + 2, name)),
);

const memoryOperations = DEVICE_OP_NAMES.map((name, index) => ({
    id: index + 1,
    name: `ttnn.${name.toLowerCase()}`,
    stack_trace: '',
    inputs: [],
    outputs: [],
    arguments: [],
    device_operations: [{ node_type: 'function_start', params: { name } }],
}));

describe('report matching under a filtered performance tab', () => {
    beforeEach(() => {
        // The endpoint really does return roughly one row per device when merging
        // is off, which is what used to break the positional match (#1812).
        vi.mocked(axiosInstance.get).mockImplementation((url: string, config?: unknown) => {
            if (url.includes('perf-results/report')) {
                const { params } = config as { params: RequestParams };

                return Promise.resolve({
                    data: {
                        report: params.merge_devices ? mergedRows : unmergedRows,
                        stacked_report: [],
                        signposts: [],
                    },
                });
            }

            if (url.includes(Endpoints.OPERATIONS_LIST)) {
                return Promise.resolve({ data: memoryOperations });
            }

            if (url.includes(Endpoints.DEVICES)) {
                return Promise.resolve({
                    data: Array.from({ length: NUM_DEVICES }, (_, device) => ({ device_id: device })),
                });
            }

            return Promise.resolve({ data: [] });
        });
    });

    it.each([
        ['at its defaults', [] as AtomProviderInitialValues],
        ['with every view filter applied', FILTERED_VIEW],
    ])('matches the memory report to the performance report with the tab %s', async (_label, view) => {
        const { result } = renderWithView(
            () => useGetDeviceOperationListPerf(),
            [[activeProfilerReportAtom, ACTIVE_REPORT], ...view],
        );

        await waitFor(() => expect(result.current).toHaveLength(DEVICE_OP_NAMES.length));

        expect(result.current.map((operation) => operation.perfData?.raw_op_code)).toEqual(DEVICE_OP_NAMES);
    });
});
