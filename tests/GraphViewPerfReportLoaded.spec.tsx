// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Provider, createStore } from 'jotai';

import type { OperationDescription } from '../src/model/APIData';
import type { ReportFolder } from '../src/definitions/Reports';

// Route wiring only. The flag under test never reaches the DOM, so the graph is
// stubbed to record what the route actually handed it.
const { mockUseOperationsList, mockUsePerformanceReport, mockUseMatchedPerfOps, graphProps } = vi.hoisted(() => ({
    mockUseOperationsList: vi.fn(),
    mockUsePerformanceReport: vi.fn(),
    mockUseMatchedPerfOps: vi.fn(),
    graphProps: [] as { isPerfReportLoaded: boolean }[],
}));

vi.mock('react-helmet-async', () => ({ Helmet: () => null }));
vi.mock('../src/hooks/useClearSelectedBuffer', () => ({ default: () => {} }));
vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: () => mockUseOperationsList(),
    usePerformanceReport: () => mockUsePerformanceReport(),
    useGetDeviceOperationListPerf: () => mockUseMatchedPerfOps(),
}));
vi.mock('../src/components/operation-graph/OperationGraphReactFlow', () => ({
    default: (props: { isPerfReportLoaded: boolean }) => {
        graphProps.push(props);
        return <div data-testid='op-graph' />;
    },
}));

/* eslint-disable import/first */
import GraphView from '../src/routes/GraphView';
import { activePerformanceReportAtom } from '../src/store/app';
/* eslint-enable import/first */

const OPERATIONS = [{ id: 1, name: 'matmul' }] as unknown as OperationDescription[];

// Folder name is derived from the path's basename, which is what the API addresses
// a report by, so a bare path is enough to stand in for a selected report.
const SELECTED_REPORT = { path: '/reports/resnet50-perf' } as ReportFolder;

const renderRoute = (selectedReport: ReportFolder | null, perfReportData: unknown) => {
    const store = createStore();
    store.set(activePerformanceReportAtom, selectedReport);
    mockUseOperationsList.mockReturnValue({ data: OPERATIONS, isLoading: false });
    mockUsePerformanceReport.mockReturnValue({ data: perfReportData });
    mockUseMatchedPerfOps.mockReturnValue([]);

    render(
        <Provider store={store}>
            <MemoryRouter>
                <GraphView />
            </MemoryRouter>
        </Provider>,
    );

    return graphProps[graphProps.length - 1];
};

afterEach(() => {
    cleanup();
    graphProps.length = 0;
    vi.clearAllMocks();
});

// This line decides UNAVAILABLE ("load a perf report") against UNLINKED ("the one
// you loaded doesn't match this graph"), which picks both the tooltip the user
// reads and whether the switch can ever enable. It was rewritten twice on this
// branch, and reverting it to `perfReport !== undefined` left the suite green.
describe('GraphView perf report loaded flag', () => {
    it('is false when no report is selected, even once the query has resolved', () => {
        // The query resolves an empty report when nothing is selected, so its data
        // alone cannot answer the question — this is the half a row-count or
        // data-only check gets wrong.
        expect(renderRoute(null, { report: [] }).isPerfReportLoaded).toBe(false);
    });

    it('is false while the selected report is still in flight', () => {
        expect(renderRoute(SELECTED_REPORT, undefined).isPerfReportLoaded).toBe(false);
    });

    it('is true for a selected report that parsed to zero rows', () => {
        // Keyed on the selection rather than the row count: otherwise a report that
        // parses to nothing tells the user to load the report they already have.
        expect(renderRoute(SELECTED_REPORT, { report: [] }).isPerfReportLoaded).toBe(true);
    });
});
