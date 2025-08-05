// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TestProviders } from './helpers/TestProviders';
import getAllButtonsWithText from './helpers/getAllButtonsWithText';
import mockSessionEmpty from './data/mockSessionEmpty.json';
import mockProfilerFolderList from './data/mockProfilerFolderList.json';
import mockPerformanceReportFolders from './data/mockPerformanceReportFolders.json';
import { ReportFolder } from '../src/definitions/Reports';
import LocalFolderSelector from '../src/components/report-selection/LocalFolderSelector';

// Scrub the markup after each test
afterEach(cleanup);

const PORTAL_CLASS = '.bp6-portal';
const TOASTIFY_CLASS = '.Toastify';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetClusterDescription: () => ({ data: null }),
    usePerfFolderList: () => ({ data: mockPerformanceReportFolders }),
    useSession: () => ({ data: mockSessionEmpty }),
    useReportFolderList: () => ({ data: mockProfilerFolderList }),
    updateTabSession: () => ({
        ...mockSessionEmpty,
        active_report: {
            profiler_name: mockProfilerFolderList[0].reportName,
        },
        profiler_path: `/Users/ctr-dblundell/Projects/ttnn-visualizer/backend/ttnn_visualizer/data/local/profiler-reports/${mockProfilerFolderList[0].path}`,
    }),
}));

it('renders the folder selector and upload fields', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    expect(getAllButtonsWithText('Select a report...')).toHaveLength(2);
    expect(screen.getByTestId('local-profiler-upload')).not.toBeNull();
    expect(screen.getByTestId('local-performance-upload')).not.toBeNull();

    getAllButtonsWithText('Select a report...')[0].click();

    await waitFor(() => document.querySelector(PORTAL_CLASS)); // Select menu is rendered in a portal

    mockProfilerFolderList.forEach((folder: ReportFolder) => {
        expect(screen.getByText(folder.reportName)).not.toBeNull();
        expect(screen.getByText(`/${folder.path}`)).not.toBeNull();
    });
});

it('updates the instance when a profiler report is selected and creates toast message', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    getAllButtonsWithText('Select a report...')[0].click();

    await waitFor(() => document.querySelector(PORTAL_CLASS)); // Select menu is rendered in a portal

    const { reportName } = mockProfilerFolderList[0];

    screen.getByText(reportName).click();

    await waitFor(() => expect(screen.getByTestId('toast-filename').textContent).to.contain(reportName));

    expect(getAllButtonsWithText(reportName)).toHaveLength(1);
    expect(getAllButtonsWithText('Select a report...')).toHaveLength(1);
});

it('updates the instance when a performance report is selected and creates toast message', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    getAllButtonsWithText('Select a report...')[1].click();

    await waitFor(() => document.querySelector(PORTAL_CLASS)); // Select menu is rendered in a portal

    const { reportName } = mockPerformanceReportFolders[0];

    screen.getByText(reportName).click();

    await waitFor(() => document.querySelector(TOASTIFY_CLASS));

    expect(getAllButtonsWithText(reportName)).toHaveLength(1);
    expect(getAllButtonsWithText('Select a report...')).toHaveLength(1);
});
