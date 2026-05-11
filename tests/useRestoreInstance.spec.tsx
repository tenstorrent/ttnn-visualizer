// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSetAtom } from 'jotai';
import { TestProviders } from './helpers/TestProviders';
import useRestoreInstance from '../src/hooks/useRestoreInstance';
import { activeProfilerReportAtom } from '../src/store/app';

const mockResetMemoryListStates = vi.fn();

const { mockUseInstance, mockUseReportFolderList } = vi.hoisted(() => ({
    mockUseInstance: vi.fn(),
    mockUseReportFolderList: vi.fn(),
}));

vi.mock('../src/hooks/useAPI', () => ({
    useInstance: () => mockUseInstance(),
    useReportFolderList: () => mockUseReportFolderList(),
}));

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({
        persistentState: {
            selectedConnection: null,
            getSavedReportFolders: () => [],
        },
    }),
}));

vi.mock('../src/hooks/useRestoreScrollPosition', async () => {
    const actual = await import('../src/hooks/useRestoreScrollPosition');
    return {
        ...actual,
        useResetMemoryListStates: () => ({
            resetMemoryListStates: mockResetMemoryListStates,
        }),
    };
});

const HookHarness = () => {
    const { hasRestoredInstance } = useRestoreInstance();
    return <div>{hasRestoredInstance ? 'restored' : 'pending'}</div>;
};

const SetProfilerReportButton = ({ path }: { path: string }) => {
    const setActiveProfilerReport = useSetAtom(activeProfilerReportAtom);

    return (
        <button
            onClick={() =>
                setActiveProfilerReport({
                    path,
                    reportName: path,
                })
            }
            type='button'
        >
            set-profiler-report
        </button>
    );
};

afterEach(cleanup);

beforeEach(() => {
    vi.clearAllMocks();
    mockUseReportFolderList.mockReturnValue({ data: [] });
    mockUseInstance.mockReturnValue({
        data: {
            active_report: {
                profiler_name: null,
                profiler_location: null,
                performance_name: null,
                performance_location: null,
                npe_name: null,
            },
            remote_profiler_folder: null,
        },
        isLoading: false,
    });
});

it('does not reset memory list state during initial instance hydration', async () => {
    render(
        <TestProviders>
            <HookHarness />
        </TestProviders>,
    );

    await waitFor(() => {
        expect(screen.getByText('restored')).toBeTruthy();
    });

    expect(mockResetMemoryListStates).toHaveBeenCalledTimes(0);
});

it('resets memory list state on first report change after null baseline', async () => {
    render(
        <TestProviders>
            <HookHarness />
            <SetProfilerReportButton path='reports/new-report' />
        </TestProviders>,
    );

    await waitFor(() => {
        expect(screen.getByText('restored')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'set-profiler-report' }));

    await waitFor(() => {
        expect(mockResetMemoryListStates).toHaveBeenCalledTimes(1);
    });
});

it('does not reset when report path remains unchanged', async () => {
    mockUseInstance.mockReturnValue({
        data: {
            active_report: {
                profiler_name: 'reports/current-report',
                profiler_location: null,
                performance_name: null,
                performance_location: null,
                npe_name: null,
            },
            remote_profiler_folder: null,
        },
        isLoading: false,
    });

    render(
        <TestProviders>
            <HookHarness />
            <SetProfilerReportButton path='reports/current-report' />
        </TestProviders>,
    );

    await waitFor(() => {
        expect(screen.getByText('restored')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'set-profiler-report' }));

    await waitFor(() => {
        expect(mockResetMemoryListStates).toHaveBeenCalledTimes(0);
    });
});
