// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Whether two reports come from the same run is a property of the reports, so
 * the fetch that decides it must not follow the performance tab's view filters
 * (#1812). Merge devices in particular returns roughly one row per device, which
 * the positional match can never line up against the memory report.
 */

import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGetDeviceOperationListPerf, useLinkedPerformanceReport, usePerformanceReport } from '../src/hooks/useAPI';
import {
    activePerformanceReportAtom,
    activePerformanceReportFolderNameAtom,
    activeProfilerReportAtom,
    filterBySignpostAtom,
    hideHostOpsAtom,
    mergeDevicesAtom,
    tracingModeAtom,
} from '../src/store/app';
import { AtomProvider, type AtomProviderInitialValues } from './helpers/atomProvider';
import axiosInstance from '../src/libs/axiosInstance';

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
    start_signpost?: string;
    end_signpost?: string;
}

const getReportRequests = (): RequestParams[] =>
    vi
        .mocked(axiosInstance.get)
        .mock.calls.filter(([url]) => String(url).includes('perf-results/report'))
        .map(([, config]) => (config as { params: RequestParams }).params);

// A fresh client per render: `staleTime: Infinity` would otherwise let one
// test's cached report answer the next test's request, hiding a refetch.
const renderWithView = <T,>(hook: () => T, view: AtomProviderInitialValues = []) =>
    renderHook(hook, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={new QueryClient()}>
                <AtomProvider initialValues={[[activePerformanceReportAtom, ACTIVE_REPORT], ...view]}>
                    {children}
                </AtomProvider>
            </QueryClientProvider>
        ),
    });

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
        renderWithView(() => {
            const name = useAtomValue(activePerformanceReportFolderNameAtom);

            return [usePerformanceReport(name), useLinkedPerformanceReport()];
        });

        await waitFor(() => expect(getReportRequests().length).toBeGreaterThan(0));

        expect(getReportRequests()).toHaveLength(1);
    });

    it('fetches separately once a view filter is applied, leaving the tab request filtered', async () => {
        renderWithView(() => {
            const name = useAtomValue(activePerformanceReportFolderNameAtom);

            return [usePerformanceReport(name), useLinkedPerformanceReport()];
        }, FILTERED_VIEW);

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

            if (url.includes('/api/operations')) {
                return Promise.resolve({ data: memoryOperations });
            }

            if (url.includes('/api/devices')) {
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
        const { result } = renderHook(() => useGetDeviceOperationListPerf(), {
            wrapper: ({ children }: { children: ReactNode }) => (
                <QueryClientProvider client={new QueryClient()}>
                    <AtomProvider
                        initialValues={[
                            [activeProfilerReportAtom, ACTIVE_REPORT],
                            [activePerformanceReportAtom, ACTIVE_REPORT],
                            ...view,
                        ]}
                    >
                        {children}
                    </AtomProvider>
                </QueryClientProvider>
            ),
        });

        await waitFor(() => expect(result.current).toHaveLength(DEVICE_OP_NAMES.length));

        expect(result.current.map((operation) => operation.perfData?.raw_op_code)).toEqual(DEVICE_OP_NAMES);
    });
});
