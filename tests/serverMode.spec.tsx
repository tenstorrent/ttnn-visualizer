// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { activePerformanceReportAtom } from '../src/store/app';
import Home from '../src/routes/Home';
import Performance from '../src/routes/Performance';
import mockPerformanceReport from './data/mockPerformanceReport.json';
import mockPerformanceReportFolders from './data/mockPerformanceReportFolders.json';
import mockDeviceLog from './data/mockDeviceLog.json';
import mockInstance from './data/mockInstance.json';
import mockProfilerFolderList from './data/mockProfilerFolderList.json';
import getButtonWithText from './helpers/getButtonWithText';
import { TestProviders } from './helpers/TestProviders';
import getAllButtonsWithText from './helpers/getAllButtonsWithText';

// Scrub the markup after each test
afterEach(cleanup);

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetClusterDescription: () => ({ data: null }),
    usePerformanceReport: () => ({ data: mockPerformanceReport }),
    usePerformanceComparisonReport: () => ({ data: null }),
    useDeviceLog: () => ({ data: mockDeviceLog }),
    usePerfFolderList: () => ({ data: mockPerformanceReportFolders }),
    usePerformanceRange: () => ({ data: null }),
    useInstance: () => ({ data: mockInstance }),
    useOpToPerfIdFiltered: () => [],
    useOperationsList: () => ({ data: [] }),
    useReportFolderList: () => ({ data: mockProfilerFolderList }),
    useGetNPEManifest: () => ({ data: null }),
}));

vi.mock('../src/functions/getServerConfig.ts', () => ({
    default: vi.fn(() => ({ SERVER_MODE: true, BASE_PATH: '/' })),
}));

it('Disable remote sync in Home route', () => {
    render(
        <TestProviders initialAtomValues={[[activePerformanceReportAtom, 'test-report']]}>
            <Home />
        </TestProviders>,
    );

    const noSelectionButtons = getAllButtonsWithText('(No selection)');

    expect(screen.getAllByTestId('remote-sync-disabled')).toHaveLength(1);
    expect(getButtonWithText('Add new connection')).toBeDisabled();
    expect(getButtonWithText('(No connection)')).toBeDisabled();
    expect(getButtonWithText('Fetch remote folders list')).toBeDisabled();
    noSelectionButtons.forEach((button) => {
        expect(button).toBeDisabled();
    });
});

it('Hide comparison component in Performance route', () => {
    render(
        <TestProviders initialAtomValues={[[activePerformanceReportAtom, 'test-report']]}>
            <Performance />
        </TestProviders>,
    );

    expect(() => screen.getAllByTestId('comparison-report-selector')).toThrowError();
});
