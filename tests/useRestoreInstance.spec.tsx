// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAtomValue, useSetAtom } from 'jotai';
import { TestProviders } from './helpers/TestProviders';
import useRestoreInstance from '../src/hooks/useRestoreInstance';
import { activeProfilerReportAtom, mlirLoadedReportsAtom } from '../src/store/app';
import type { GraphBundle } from '../src/model/MLIRJsonModel';
import ProtectedRoute from '../src/components/ProtectedRoute';
import ROUTES from '../src/definitions/Routes';

const mockResetMemoryListStates = vi.fn();

const { mockUseInstance, mockUseReportFolderList, recordReportLoaded, recordReportLoadFailed } = vi.hoisted(() => ({
    mockUseInstance: vi.fn(),
    mockUseReportFolderList: vi.fn(),
    recordReportLoaded: vi.fn(),
    recordReportLoadFailed: vi.fn(),
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

vi.mock('../src/functions/reportLoadUsage', () => ({
    recordReportLoaded,
    recordReportLoadFailed,
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

const SAMPLE_GRAPH = { graphs: [{ id: 'g0', nodes: [] }] } as unknown as GraphBundle;

const HookHarness = () => {
    const { hasRestoredInstance } = useRestoreInstance();
    return <div>{hasRestoredInstance ? 'restored' : 'pending'}</div>;
};

const MlirReportsProbe = () => {
    const reports = useAtomValue(mlirLoadedReportsAtom);
    return <pre data-testid='mlir-loaded-reports'>{JSON.stringify(reports)}</pre>;
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

it('does not record restored reports as user-initiated loads', async () => {
    mockUseInstance.mockReturnValue({
        data: {
            active_report: {
                profiler_name: 'restored-profiler',
                profiler_location: 'local',
                performance_name: 'restored-performance',
                performance_location: 'local',
                npe_name: 'restored-npe',
                mlir_name: 'restored-mlir',
            },
            remote_profiler_folder: null,
        },
        isLoading: false,
    });

    render(
        <TestProviders>
            <HookHarness />
        </TestProviders>,
    );

    await waitFor(() => expect(screen.getByText('restored')).toBeTruthy());
    expect(recordReportLoaded).not.toHaveBeenCalled();
    expect(recordReportLoadFailed).not.toHaveBeenCalled();
});

it('keeps report selection unavailable until instance restoration has settled', async () => {
    mockUseReportFolderList.mockReturnValue({ data: null });
    mockUseInstance.mockReturnValue({
        data: {
            active_report: {
                profiler_name: 'restored-profiler',
                profiler_location: 'local',
                performance_name: null,
                performance_location: null,
                npe_name: null,
            },
            remote_profiler_folder: null,
        },
        isLoading: false,
    });

    const getProtectedSelection = () => (
        <TestProviders>
            <ProtectedRoute>
                <button type='button'>choose-report</button>
            </ProtectedRoute>
        </TestProviders>
    );
    const { rerender } = render(getProtectedSelection());

    expect(screen.queryByRole('button', { name: 'choose-report' })).toBeNull();
    expect(screen.getByText('Initializing instance...')).toBeTruthy();

    mockUseReportFolderList.mockReturnValue({ data: [] });
    rerender(getProtectedSelection());

    await waitFor(() => expect(screen.getByRole('button', { name: 'choose-report' })).toBeTruthy());
    expect(recordReportLoaded).not.toHaveBeenCalled();
    expect(recordReportLoadFailed).not.toHaveBeenCalled();
});

it('shows restoration progress before evaluating report-required redirects', () => {
    mockUseReportFolderList.mockReturnValue({ data: null });
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

    render(
        <TestProviders initialEntries={[ROUTES.OPERATIONS]}>
            <ProtectedRoute>
                <div>operations</div>
            </ProtectedRoute>
        </TestProviders>,
    );

    expect(screen.getByText('Initializing instance...')).toBeTruthy();
    expect(screen.queryByText('operations')).toBeNull();
});

it('restores the instance when the report list is unavailable', async () => {
    mockUseReportFolderList.mockReturnValue({ data: null, isError: true });

    render(
        <TestProviders>
            <HookHarness />
        </TestProviders>,
    );

    await waitFor(() => expect(screen.getByText('restored')).toBeTruthy());
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

it('does not overwrite an in-memory MLIR session when restoring the instance', async () => {
    const seededReports = [
        { name: 'primary', data: SAMPLE_GRAPH },
        { name: 'peer', data: SAMPLE_GRAPH },
    ];

    mockUseInstance.mockReturnValue({
        data: {
            active_report: {
                profiler_name: null,
                profiler_location: null,
                performance_name: null,
                performance_location: null,
                npe_name: null,
                mlir_name: 'instance-mlir',
            },
            remote_profiler_folder: null,
        },
        isLoading: false,
    });

    render(
        <TestProviders initialAtomValues={[[mlirLoadedReportsAtom, seededReports]]}>
            <HookHarness />
            <MlirReportsProbe />
        </TestProviders>,
    );

    await waitFor(() => {
        expect(screen.getByText('restored')).toBeTruthy();
    });

    // Restore must skip setActiveMlirJson when reports are already seeded —
    // otherwise a two-file View would lose its peer (and graph data).
    expect(JSON.parse(screen.getByTestId('mlir-loaded-reports').textContent ?? '[]')).toEqual(seededReports);
});

it('seeds the active MLIR name from the instance when memory is empty', async () => {
    mockUseInstance.mockReturnValue({
        data: {
            active_report: {
                profiler_name: null,
                profiler_location: null,
                performance_name: null,
                performance_location: null,
                npe_name: null,
                mlir_name: 'instance-mlir',
            },
            remote_profiler_folder: null,
        },
        isLoading: false,
    });

    render(
        <TestProviders>
            <HookHarness />
            <MlirReportsProbe />
        </TestProviders>,
    );

    await waitFor(() => {
        expect(screen.getByText('restored')).toBeTruthy();
    });

    expect(JSON.parse(screen.getByTestId('mlir-loaded-reports').textContent ?? '[]')).toEqual([
        { name: 'instance-mlir', data: null },
    ]);
});
