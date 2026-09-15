// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Provider, createStore } from 'jotai';
import type { NumberRange } from '@blueprintjs/core';

import type { OperationDescription } from '../src/model/APIData';
import GraphView from '../src/routes/GraphView';
import { selectedOperationRangeAtom } from '../src/store/app';

// The range filter is route-level and never reaches the DOM, so the graph is stubbed
// to record the list the route actually handed it.
const { mockUseOperationsList, mockUseLinkedPerformanceReport, mockUseMatchedPerfOps, graphProps } = vi.hoisted(() => ({
    mockUseOperationsList: vi.fn(),
    mockUseLinkedPerformanceReport: vi.fn(),
    mockUseMatchedPerfOps: vi.fn(),
    graphProps: [] as { operationList: OperationDescription[]; operationId: number | undefined }[],
}));

vi.mock('react-helmet-async', () => ({ Helmet: () => null }));
vi.mock('../src/hooks/useClearSelectedBuffer', () => ({ default: () => {} }));
vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: () => mockUseOperationsList(),
    useLinkedPerformanceReport: () => mockUseLinkedPerformanceReport(),
    useGetDeviceOperationListPerf: () => mockUseMatchedPerfOps(),
}));
vi.mock('../src/components/operation-graph/OperationGraphReactFlow', () => ({
    default: (props: { operationList: OperationDescription[]; operationId: number | undefined }) => {
        graphProps.push(props);
        return <div data-testid='op-graph' />;
    },
}));

const operationsFrom = (firstId: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({
        id: firstId + index,
        name: 'ttnn.matmul',
    })) as unknown as OperationDescription[];

const renderRoute = (operations: OperationDescription[], range: NumberRange | null, path = '/graphtree') => {
    const store = createStore();
    store.set(selectedOperationRangeAtom, range);
    mockUseOperationsList.mockReturnValue({ data: operations, isLoading: false });
    mockUseLinkedPerformanceReport.mockReturnValue({ data: undefined });
    mockUseMatchedPerfOps.mockReturnValue([]);

    render(
        <Provider store={store}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route
                        path='/graphtree/:operationId?'
                        element={<GraphView />}
                    />
                </Routes>
            </MemoryRouter>
        </Provider>,
    );

    return graphProps[graphProps.length - 1];
};

// The graph is stubbed, so its absence means the route rendered the spinner instead —
// which is the failure the zero-based case exists to catch. Say so, rather than
// letting it surface as a property read on undefined.
const expectGraphRendered = (
    graph: { operationList: OperationDescription[]; operationId: number | undefined } | undefined,
) => {
    expect(graph).toBeDefined();
    return graph!;
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
        const graph = expectGraphRendered(renderRoute(operationsFrom(1, 1000), [500, 600]));

        expect(graph.operationList).toHaveLength(101);
        expect(graph.operationList[0].id).toBe(500);
        expect(graph.operationList[graph.operationList.length - 1].id).toBe(600);
    });

    it('renders a report whose operation ids start at 0', () => {
        // A start of 0 made the old guard falsy for every op, so the list came back empty
        // and the route read that as still-loading: a spinner that never resolved. #1999
        const graph = expectGraphRendered(renderRoute(operationsFrom(0, 1184), [0, 1183]));

        expect(screen.getByTestId('op-graph')).toBeInTheDocument();
        expect(graph.operationList).toHaveLength(1184);
    });

    it('passes the whole list through when no range is selected', () => {
        const graph = expectGraphRendered(renderRoute(operationsFrom(1, 10), null));

        expect(graph.operationList).toHaveLength(10);
    });

    it('renders an empty graph when the range selects nothing', () => {
        // The footer's min input is unclamped, so a min above the max is reachable and
        // selects no ops. That must read as an empty graph, not as a pending fetch. #1999
        const graph = expectGraphRendered(renderRoute(operationsFrom(1, 100), [2000, 50]));

        expect(graph.operationList).toHaveLength(0);
    });
});

describe('GraphView named operation', () => {
    it('passes through operation 0', () => {
        // Guards the id that reads as absent everywhere else in this view; the route
        // param is a string, so the previous truthiness check happened to be safe here.
        const graph = expectGraphRendered(renderRoute(operationsFrom(0, 10), null, '/graphtree/0'));

        expect(graph.operationId).toBe(0);
    });

    it('passes through an ordinary id', () => {
        const graph = expectGraphRendered(renderRoute(operationsFrom(1, 10), null, '/graphtree/5'));

        expect(graph.operationId).toBe(5);
    });

    it('names no operation when the route names none', () => {
        const graph = expectGraphRendered(renderRoute(operationsFrom(1, 10), null, '/graphtree'));

        expect(graph.operationId).toBeUndefined();
    });

    it.each(['latest', '5abc', '1.5', '-3', '1e5', '  7', '99999999999999999999'])(
        'names no operation for the malformed segment %s',
        (segment) => {
            // `parseInt` read a numeric prefix, so `5abc` selected op 5 and `1.5` op 1 —
            // a real node for a malformed path. The whole segment has to be an id.
            const graph = expectGraphRendered(renderRoute(operationsFrom(1, 10), null, `/graphtree/${segment}`));

            expect(graph.operationId).toBeUndefined();
        },
    );

    it('names no operation for an empty trailing segment', () => {
        // Kept separate: this is the "no id named" path rather than a malformed one.
        const graph = expectGraphRendered(renderRoute(operationsFrom(1, 10), null, '/graphtree'));

        expect(graph.operationId).toBeUndefined();
    });
});
