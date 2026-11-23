// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosError } from 'axios';
import NpeWindowedView from '../src/components/npe/NpeWindowedView';
import { useNpeSummary, useNpeWindow } from '../src/hooks/useAPI';
import { NoCTransfer, NpeSummary, NpeWindow } from '../src/model/NPEModel';
import { TEST_IDS } from '../src/definitions/TestIds';
import { NPEValidationError } from '../src/definitions/NPEData';
import { npeWindow, summary } from './helpers/npeFixtures';

vi.mock('../src/hooks/useAPI', () => ({
    useNpeSummary: vi.fn(),
    useNpeWindow: vi.fn(),
}));

vi.mock('../src/components/npe/NPEViewComponent', () => ({
    default: ({ selectedTimestep, hasFabricEvents }: { selectedTimestep?: number; hasFabricEvents?: boolean }) => (
        <div
            data-testid={TEST_IDS.NPE_VIEW}
            data-has-fabric-events={String(hasFabricEvents)}
        >
            step:{selectedTimestep}
        </div>
    ),
}));

const mockedSummary = vi.mocked(useNpeSummary);
const mockedWindow = vi.mocked(useNpeWindow);
const onInitialLoadSuccess = vi.fn();
const onInitialLoadFailure = vi.fn();

const windowedView = (loadAttemptId: number | null = null) => (
    <NpeWindowedView
        fileName='trace.json'
        loadAttempt={{
            id: loadAttemptId,
            complete: onInitialLoadSuccess,
            fail: onInitialLoadFailure,
        }}
    />
);

type SummaryHook = ReturnType<typeof useNpeSummary>;
type WindowHook = ReturnType<typeof useNpeWindow>;

const settledSummary = (data: NpeSummary) => ({ data, isLoading: false, isError: false, error: null }) as SummaryHook;
const settledWindow = (data?: NpeWindow) => ({ data, isError: false, error: null }) as WindowHook;

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
        mockedWindow.mockReturnValue(settledWindow());

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
        mockedWindow.mockReturnValue(settledWindow());

        render(windowedView());

        expect(screen.getByText('Processing…')).toBeDefined();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).toBeNull();
    });

    it('renders the view and auto-jumps to the first active step', () => {
        mockedSummary.mockReturnValue(settledSummary(summary));
        mockedWindow.mockReturnValue(settledWindow(npeWindow));

        render(windowedView());

        // active_count = [0, 2, 0] → first active step is index 1.
        expect(screen.getByTestId(TEST_IDS.NPE_VIEW).textContent).toBe('step:1');
    });

    // #2356: the window holds no fabric transfers, but the whole trace does, so the
    // view must be told so rather than decide from the window.
    it.each([true, false])(
        "passes the whole trace's fabric-event flag (%s) to the view, not the window's",
        (hasFabricEvents) => {
            mockedSummary.mockReturnValue(settledSummary({ ...summary, has_fabric_events: hasFabricEvents }));
            mockedWindow.mockReturnValue(settledWindow(npeWindow));

            render(windowedView());

            // Guards the fixture: the test means nothing if the window had fabric transfers.
            expect(npeWindow.transfers).toEqual([]);
            expect(screen.getByTestId(TEST_IDS.NPE_VIEW).getAttribute('data-has-fabric-events')).toBe(
                String(hasFabricEvents),
            );
        },
    );

    it("keeps the whole trace's fabric-event flag when a scrub loads a window with fabric transfers", () => {
        mockedSummary.mockReturnValue(settledSummary({ ...summary, has_fabric_events: false }));
        mockedWindow.mockReturnValue(settledWindow(npeWindow));
        const { rerender } = render(windowedView());
        const flag = () => screen.getByTestId(TEST_IDS.NPE_VIEW).getAttribute('data-has-fabric-events');
        expect(flag()).toBe('false');

        const fabricTransfer: NoCTransfer = {
            id: 0,
            src: [0, 0, 0],
            dst: [[0, 1, 1]],
            total_bytes: 0,
            noc_event_type: '',
            fabric_event_type: true,
            start_cycle: 0,
            end_cycle: 0,
            route: [],
        };
        mockedWindow.mockReturnValue(settledWindow({ ...npeWindow, transfers: [fabricTransfer] }));
        rerender(windowedView());

        expect(flag()).toBe('false');
    });

    it('reports one successful initial load for the active attempt', async () => {
        mockedSummary.mockReturnValue(settledSummary(summary));
        mockedWindow.mockReturnValue(settledWindow(npeWindow));

        render(windowedView(7));

        await waitFor(() => expect(onInitialLoadSuccess).toHaveBeenCalledWith(7));
        expect(onInitialLoadFailure).not.toHaveBeenCalled();
    });

    it('rejects an unsupported summary version before counting the load', async () => {
        mockedSummary.mockReturnValue(
            settledSummary({ ...summary, common_info: { ...summary.common_info, version: '2.0.0' } }),
        );
        mockedWindow.mockReturnValue(settledWindow(npeWindow));

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
        mockedSummary.mockReturnValue(settledSummary(summary));
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
        mockedSummary.mockReturnValue(settledSummary(emptySummary));
        mockedWindow.mockReturnValue(settledWindow());

        render(windowedView(11));

        expect(screen.getByTestId(TEST_IDS.NPE_PROCESSING_EMPTY_TRACE)).toBeDefined();
        expect(screen.getByText('Empty NPE trace')).toBeDefined();
        expect(screen.queryByTestId(TEST_IDS.NPE_VIEW)).toBeNull();
        await waitFor(() => expect(onInitialLoadFailure).toHaveBeenCalledWith(11, NPEValidationError.EMPTY_NPE_TRACE));
    });

    it('re-clamps the selected timestep when a new (shorter) summary arrives', () => {
        // Report A: 3 steps, auto-jumps to the active step 1.
        mockedSummary.mockReturnValue(settledSummary(summary));
        mockedWindow.mockReturnValue(settledWindow(npeWindow));
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
        mockedSummary.mockReturnValue(settledSummary(shorter));
        act(() => {
            rerender(windowedView());
        });

        expect(screen.getByTestId(TEST_IDS.NPE_VIEW).textContent).toBe('step:0');
    });

    it('surfaces and records a first-window error when no frame has loaded yet', async () => {
        mockedSummary.mockReturnValue(settledSummary(summary));
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
