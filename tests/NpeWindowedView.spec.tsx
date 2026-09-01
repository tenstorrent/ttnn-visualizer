// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosError } from 'axios';
import NpeWindowedView from '../src/components/npe/NpeWindowedView';
import { useNpeSummary, useNpeWindow } from '../src/hooks/useAPI';
import { CommonInfo, NoCType, NpeSummary, NpeWindow } from '../src/model/NPEModel';
import { TEST_IDS } from '../src/definitions/TestIds';
import { NPEValidationError } from '../src/definitions/NPEData';

vi.mock('../src/hooks/useAPI', () => ({
    useNpeSummary: vi.fn(),
    useNpeWindow: vi.fn(),
}));

vi.mock('../src/components/npe/NPEViewComponent', () => ({
    default: ({ selectedTimestep }: { selectedTimestep?: number }) => (
        <div data-testid={TEST_IDS.NPE_VIEW}>step:{selectedTimestep}</div>
    ),
}));

const summary: NpeSummary = {
    common_info: { version: '1.0.0' } as CommonInfo,
    chips: {},
    zones: [],
    n_timesteps: 3,
    timesteps: {
        start_cycle: [0, 10, 20],
        end_cycle: [9, 19, 29],
        avg_link_demand: [1, 2, 3],
        avg_link_util: [4, 5, 6],
        max_link_demand: [7, 8, 9],
        mcast_write_link_util: [0.1, 0.2, 0.3],
        active_count: [0, 2, 0],
    },
};

const npeWindow: NpeWindow = {
    t: 1,
    timestep: {
        active_transfers: [],
        link_demand: [],
        max_link_demand: 8,
        avg_link_demand: 20,
        avg_link_util: 21,
        mcast_write_link_util: 0.9,
        noc: {
            [NoCType.NOC0]: { avg_link_demand: 0, avg_link_util: 0 },
            [NoCType.NOC1]: { avg_link_demand: 0, avg_link_util: 0 },
        },
    },
    transfers: [],
};

const mockedSummary = vi.mocked(useNpeSummary);
const mockedWindow = vi.mocked(useNpeWindow);
const onInitialLoadSuccess = vi.fn();
const onInitialLoadFailure = vi.fn();

const windowedView = (loadAttemptId: number | null = null) => (
    <NpeWindowedView
        fileName='trace.json'
        loadAttemptId={loadAttemptId}
        onInitialLoadSuccess={onInitialLoadSuccess}
        onInitialLoadFailure={onInitialLoadFailure}
    />
);

type SummaryHook = ReturnType<typeof useNpeSummary>;
type WindowHook = ReturnType<typeof useNpeWindow>;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('NpeWindowedView', () => {
    it('surfaces and records index-build errors instead of an infinite spinner', async () => {
        mockedSummary.mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: true,
            error: new Error('index build failed') as AxiosError,
        } as SummaryHook);
        mockedWindow.mockReturnValue({ data: undefined, isError: false, error: null } as WindowHook);

        render(windowedView(10));

        expect(screen.getByText('Unable to load NPE report')).toBeDefined();
        expect(screen.getByText('index build failed')).toBeDefined();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).toBeNull();
        await waitFor(() =>
            expect(onInitialLoadFailure).toHaveBeenCalledWith(
                10,
                NPEValidationError.DEFAULT,
                expect.objectContaining({ message: 'index build failed' }),
            ),
        );
        expect(onInitialLoadFailure).toHaveBeenCalledTimes(1);
    });

    it('shows a building-index spinner while the summary loads', () => {
        mockedSummary.mockReturnValue({
            data: undefined,
            isLoading: true,
            isError: false,
            error: null,
        } as SummaryHook);
        mockedWindow.mockReturnValue({ data: undefined, isError: false, error: null } as WindowHook);

        render(windowedView());

        expect(screen.getByText('Processing…')).toBeDefined();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).toBeNull();
    });

    it('renders the view and auto-jumps to the first active step', () => {
        mockedSummary.mockReturnValue({
            data: summary,
            isLoading: false,
            isError: false,
            error: null,
        } as SummaryHook);
        mockedWindow.mockReturnValue({ data: npeWindow, isError: false, error: null } as WindowHook);

        render(windowedView());

        // active_count = [0, 2, 0] → first active step is index 1.
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW).textContent).toBe('step:1');
    });

    it('reports one successful initial load for the active attempt', async () => {
        mockedSummary.mockReturnValue({
            data: summary,
            isLoading: false,
            isError: false,
            error: null,
        } as SummaryHook);
        mockedWindow.mockReturnValue({ data: npeWindow, isError: false, error: null } as WindowHook);

        render(windowedView(7));

        await waitFor(() => expect(onInitialLoadSuccess).toHaveBeenCalledWith(7));
        expect(onInitialLoadSuccess).toHaveBeenCalledTimes(1);
        expect(onInitialLoadFailure).not.toHaveBeenCalled();
    });

    it('rejects an unsupported summary version before counting the load', async () => {
        mockedSummary.mockReturnValue({
            data: { ...summary, common_info: { ...summary.common_info, version: '2.0.0' } },
            isLoading: false,
            isError: false,
            error: null,
        } as SummaryHook);
        mockedWindow.mockReturnValue({ data: npeWindow, isError: false, error: null } as WindowHook);

        render(windowedView(8));

        await waitFor(() =>
            expect(onInitialLoadFailure).toHaveBeenCalledWith(8, NPEValidationError.INVALID_NPE_VERSION),
        );
        expect(onInitialLoadSuccess).not.toHaveBeenCalled();
        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_INVALID_VERSION)).toBeDefined();
    });

    it('degrades in place on a window error when a previous frame is available', () => {
        // keepPreviousData keeps the last good window, so the view stays up and a
        // non-blocking notice appears instead of replacing everything with an error.
        mockedSummary.mockReturnValue({
            data: summary,
            isLoading: false,
            isError: false,
            error: null,
        } as SummaryHook);
        mockedWindow.mockReturnValue({
            data: npeWindow,
            isError: true,
            error: new Error('timestep 42 out of range') as AxiosError,
        } as WindowHook);

        render(windowedView(9));

        expect(screen.getByText('Timestep failed to load')).toBeDefined();
        expect(screen.getByText(/timestep 42 out of range/)).toBeDefined();
        // The scrubber-bearing view is still rendered so the user can recover.
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW)).toBeDefined();
        expect(onInitialLoadFailure).not.toHaveBeenCalled();
    });

    it('shows and records an empty-report notice for a zero-timestep trace', async () => {
        const emptySummary: NpeSummary = {
            ...summary,
            n_timesteps: 0,
            timesteps: {
                start_cycle: [],
                end_cycle: [],
                avg_link_demand: [],
                avg_link_util: [],
                max_link_demand: [],
                mcast_write_link_util: [],
                active_count: [],
            },
        };
        mockedSummary.mockReturnValue({
            data: emptySummary,
            isLoading: false,
            isError: false,
            error: null,
        } as SummaryHook);
        mockedWindow.mockReturnValue({ data: undefined, isError: false, error: null } as WindowHook);

        render(windowedView(11));

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_EMPTY_TRACE)).toBeDefined();
        expect(screen.getByText('Empty NPE trace')).toBeDefined();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).toBeNull();
        await waitFor(() => expect(onInitialLoadFailure).toHaveBeenCalledWith(11, NPEValidationError.EMPTY_NPE_TRACE));
    });

    it('re-clamps the selected timestep when a new (shorter) summary arrives', () => {
        // Report A: 3 steps, auto-jumps to the active step 1.
        mockedSummary.mockReturnValue({ data: summary, isLoading: false, isError: false, error: null } as SummaryHook);
        mockedWindow.mockReturnValue({ data: npeWindow, isError: false, error: null } as WindowHook);
        const { rerender } = render(windowedView());
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW).textContent).toBe('step:1');

        // Same-name re-upload → fresh summary object with a single idle step. The
        // stale selectedTimestep (1) is now out of range; identity change resets it.
        const shorter: NpeSummary = {
            ...summary,
            n_timesteps: 1,
            timesteps: {
                start_cycle: [0],
                end_cycle: [9],
                avg_link_demand: [1],
                avg_link_util: [4],
                max_link_demand: [7],
                mcast_write_link_util: [0.1],
                active_count: [0],
            },
        };
        mockedSummary.mockReturnValue({ data: shorter, isLoading: false, isError: false, error: null } as SummaryHook);
        act(() => {
            rerender(windowedView());
        });

        expect(screen.getByTestId(TEST_IDS.NPE_VIEW).textContent).toBe('step:0');
    });

    it('surfaces and records a first-window error when no frame has loaded yet', async () => {
        mockedSummary.mockReturnValue({
            data: summary,
            isLoading: false,
            isError: false,
            error: null,
        } as SummaryHook);
        mockedWindow.mockReturnValue({
            data: undefined,
            isError: true,
            error: new Error('window fetch failed') as AxiosError,
        } as WindowHook);

        render(windowedView(12));

        expect(screen.getByText('Unable to load NPE timestep')).toBeDefined();
        expect(screen.getByText('window fetch failed')).toBeDefined();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).toBeNull();
        await waitFor(() =>
            expect(onInitialLoadFailure).toHaveBeenCalledWith(
                12,
                NPEValidationError.DEFAULT,
                expect.objectContaining({ message: 'window fetch failed' }),
            ),
        );
    });

    it('keeps showing Processing… when a window errors while the summary is still loading', () => {
        // A window request can race ahead of the index build (e.g. the guaranteed
        // t=0 404 on an empty trace). Until the summary resolves the real state, the
        // premature error must not flash — the spinner wins.
        mockedSummary.mockReturnValue({
            data: undefined,
            isLoading: true,
            isError: false,
            error: null,
        } as SummaryHook);
        mockedWindow.mockReturnValue({
            data: undefined,
            isError: true,
            error: new Error('timestep 0 out of range') as AxiosError,
        } as WindowHook);

        render(windowedView());

        expect(screen.getByText('Processing…')).toBeDefined();
        expect(screen.queryByText('Unable to load NPE timestep')).toBeNull();
    });
});
