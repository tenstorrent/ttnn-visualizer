// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AxiosError } from 'axios';
import NpeWindowedView from '../src/components/npe/NpeWindowedView';
import { useNpeSummary, useNpeWindow } from '../src/hooks/useAPI';
import { CommonInfo, NoCType, NpeSummary, NpeWindow } from '../src/model/NPEModel';

vi.mock('../src/hooks/useAPI', () => ({
    useNpeSummary: vi.fn(),
    useNpeWindow: vi.fn(),
}));

vi.mock('../src/components/npe/NPEViewComponent', () => ({
    default: ({ selectedTimestep }: { selectedTimestep?: number }) => (
        <div data-testid='npe-view'>step:{selectedTimestep}</div>
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

type SummaryHook = ReturnType<typeof useNpeSummary>;
type WindowHook = ReturnType<typeof useNpeWindow>;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('NpeWindowedView', () => {
    it('surfaces index-build errors instead of an infinite spinner', () => {
        mockedSummary.mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: true,
            error: new Error('index build failed') as AxiosError,
        } as SummaryHook);
        mockedWindow.mockReturnValue({ data: undefined, isError: false, error: null } as WindowHook);

        render(<NpeWindowedView fileName='trace.json' />);

        expect(screen.getByText('Unable to load NPE report')).toBeDefined();
        expect(screen.getByText('index build failed')).toBeDefined();
        expect(screen.queryByTestId('npe-view')).toBeNull();
    });

    it('shows a building-index spinner while the summary loads', () => {
        mockedSummary.mockReturnValue({
            data: undefined,
            isLoading: true,
            isError: false,
            error: null,
        } as SummaryHook);
        mockedWindow.mockReturnValue({ data: undefined, isError: false, error: null } as WindowHook);

        render(<NpeWindowedView fileName='trace.json' />);

        expect(screen.getByText('Processing…')).toBeDefined();
        expect(screen.queryByTestId('npe-view')).toBeNull();
    });

    it('renders the view and auto-jumps to the first active step', () => {
        mockedSummary.mockReturnValue({
            data: summary,
            isLoading: false,
            isError: false,
            error: null,
        } as SummaryHook);
        mockedWindow.mockReturnValue({ data: npeWindow, isError: false, error: null } as WindowHook);

        render(<NpeWindowedView fileName='trace.json' />);

        // active_count = [0, 2, 0] → first active step is index 1.
        expect(screen.getByTestId('npe-view').textContent).toBe('step:1');
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

        render(<NpeWindowedView fileName='trace.json' />);

        expect(screen.getByText('Timestep failed to load')).toBeDefined();
        expect(screen.getByText(/timestep 42 out of range/)).toBeDefined();
        // The scrubber-bearing view is still rendered so the user can recover.
        expect(screen.getByTestId('npe-view')).toBeDefined();
    });

    it('shows an empty-report notice for a zero-timestep trace', () => {
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

        render(<NpeWindowedView fileName='trace.json' />);

        expect(screen.getByText('Empty NPE report')).toBeDefined();
        expect(screen.queryByTestId('npe-view')).toBeNull();
    });

    it('re-clamps the selected timestep when a new (shorter) summary arrives', () => {
        // Report A: 3 steps, auto-jumps to the active step 1.
        mockedSummary.mockReturnValue({ data: summary, isLoading: false, isError: false, error: null } as SummaryHook);
        mockedWindow.mockReturnValue({ data: npeWindow, isError: false, error: null } as WindowHook);
        const { rerender } = render(<NpeWindowedView fileName='trace.json' />);
        expect(screen.getByTestId('npe-view').textContent).toBe('step:1');

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
            rerender(<NpeWindowedView fileName='trace.json' />);
        });

        expect(screen.getByTestId('npe-view').textContent).toBe('step:0');
    });

    it('surfaces a first-window error when no frame has loaded yet', () => {
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

        render(<NpeWindowedView fileName='trace.json' />);

        expect(screen.getByText('Unable to load NPE timestep')).toBeDefined();
        expect(screen.getByText('window fetch failed')).toBeDefined();
        expect(screen.queryByTestId('npe-view')).toBeNull();
    });
});
