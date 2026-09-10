// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Provider, createStore } from 'jotai';
import type { NumberRange } from '@blueprintjs/core';

import type { OperationDescription } from '../src/model/APIData';

// The range filter is route-level and never reaches the DOM, so the graph is stubbed
// to record the list the route actually handed it.
const { mockUseOperationsList, mockUseLinkedPerformanceReport, mockUseMatchedPerfOps, graphProps } = vi.hoisted(() => ({
    mockUseOperationsList: vi.fn(),
    mockUseLinkedPerformanceReport: vi.fn(),
    mockUseMatchedPerfOps: vi.fn(),
    graphProps: [] as { operationList: OperationDescription[] }[],
}));

vi.mock('react-helmet-async', () => ({ Helmet: () => null }));
vi.mock('../src/hooks/useClearSelectedBuffer', () => ({ default: () => {} }));
vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: () => mockUseOperationsList(),
    useLinkedPerformanceReport: () => mockUseLinkedPerformanceReport(),
    useGetDeviceOperationListPerf: () => mockUseMatchedPerfOps(),
}));
vi.mock('../src/components/operation-graph/OperationGraphReactFlow', () => ({
    default: (props: { operationList: OperationDescription[] }) => {
        graphProps.push(props);
        return <div data-testid='op-graph' />;
    },
}));

/* eslint-disable import/first */
import GraphView from '../src/routes/GraphView';
import { selectedOperationRangeAtom } from '../src/store/app';
/* eslint-enable import/first */

const operationsFrom = (firstId: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({
        id: firstId + index,
        name: 'ttnn.matmul',
    })) as unknown as OperationDescription[];

const renderRoute = (operations: OperationDescription[], range: NumberRange | null) => {
    const store = createStore();
    store.set(selectedOperationRangeAtom, range);
    mockUseOperationsList.mockReturnValue({ data: operations, isLoading: false });
    mockUseLinkedPerformanceReport.mockReturnValue({ data: undefined });
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

describe('GraphView operation range', () => {
    it('honours the lower bound as well as the upper one', () => {
        // The start used to be read as a truthiness guard rather than compared against,
        // so the left-hand handle of the Range control moved nothing. #1999
        const graph = renderRoute(operationsFrom(1, 1000), [500, 600]);

        expect(graph.operationList).toHaveLength(101);
        expect(graph.operationList[0].id).toBe(500);
        expect(graph.operationList[graph.operationList.length - 1].id).toBe(600);
    });

    it('renders a report whose operation ids start at 0', () => {
        // A start of 0 made the old guard falsy for every op, so the list came back empty
        // and the route read that as still-loading: a spinner that never resolved. #1999
        const graph = renderRoute(operationsFrom(0, 1184), [0, 1183]);

        expect(screen.getByTestId('op-graph')).toBeInTheDocument();
        expect(graph.operationList).toHaveLength(1184);
    });

    it('passes the whole list through when no range is selected', () => {
        const graph = renderRoute(operationsFrom(1, 10), null);

        expect(graph.operationList).toHaveLength(10);
    });
});
