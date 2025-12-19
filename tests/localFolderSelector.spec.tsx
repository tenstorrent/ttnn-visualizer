// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TestProviders } from './helpers/TestProviders';
import getAllButtonsWithText from './helpers/getAllButtonsWithText';
import mockInstanceEmpty from './data/mockInstanceEmpty.json';
import mockProfilerFolderList from './data/mockProfilerFolderList.json';
import mockPerformanceReportFolders from './data/mockPerformanceReportFolders.json';
import { ReportFolder } from '../src/definitions/Reports';
import LocalFolderSelector from '../src/components/report-selection/LocalFolderSelector';
import { TEST_IDS } from '../src/definitions/TestIds';
import testForPortal from './helpers/testForPortal';

// Scrub the markup after each test
afterEach(cleanup);

const WAIT_FOR_OPTIONS = { timeout: 1000 };
const SELECT_REPORT_TEXT = 'Select a report...';

vi.mock('../src/hooks/useLocal', async () => {
    const actual = await import('../src/hooks/useLocal');

    return {
        default: () => ({
            ...actual.default(),
            uploadLocalFolder: vi.fn().mockResolvedValue({ status: 200, data: mockProfilerFolderList[0] }),
            uploadLocalPerformanceFolder: vi.fn().mockResolvedValue({
                status: 200,
                data: { status: 3, detail: null, message: 'success' },
            }),
        }),
    };
});

vi.mock('../src/hooks/useAPI', async () => {
    const actual = await import('../src/hooks/useAPI');

    return {
        ...actual,
        useGetClusterDescription: () => ({ data: null }),
        usePerfFolderList: () => ({ data: mockPerformanceReportFolders }),
        useInstance: () => ({ data: mockInstanceEmpty }),
        useReportFolderList: () => ({ data: mockProfilerFolderList }),
        updateInstance: vi.fn().mockResolvedValue({
            ...mockInstanceEmpty,
            active_report: {
                profiler_name: {
                    reportName: mockProfilerFolderList[0].reportName,
                    path: mockProfilerFolderList[0].path,
                },
            },
            profiler_path: `/Users/ctr-dblundell/Projects/ttnn-visualizer/backend/ttnn_visualizer/data/local/profiler-reports/${mockProfilerFolderList[0].path}`,
        }),
        deleteProfiler: vi.fn().mockResolvedValue({ success: true }),
        deletePerformance: vi.fn().mockResolvedValue({ success: true }),
    };
});

it('renders the initial folder selector upload field states', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    expect(getAllButtonsWithText(SELECT_REPORT_TEXT)).toHaveLength(2);
    expect(screen.getByTestId(TEST_IDS.LOCAL_PROFILER_UPLOAD)).not.toBeNull();
    expect(screen.getByTestId(TEST_IDS.LOCAL_PERFORMANCE_UPLOAD)).not.toBeNull();

    getAllButtonsWithText(SELECT_REPORT_TEXT)[0].click();

    await waitFor(testForPortal, WAIT_FOR_OPTIONS); // Select menu is rendered in a portal

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

    getAllButtonsWithText(SELECT_REPORT_TEXT)[0].click();

    await waitFor(testForPortal, WAIT_FOR_OPTIONS); // Select menu is rendered in a portal

    const { reportName } = mockProfilerFolderList[0];

    screen.getByText(reportName).click();

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(reportName),
        WAIT_FOR_OPTIONS,
    );

    expect(getAllButtonsWithText(reportName)).toHaveLength(1);
    expect(getAllButtonsWithText(SELECT_REPORT_TEXT)).toHaveLength(1);
});

it('updates the instance when a performance report is selected and creates toast message', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    getAllButtonsWithText(SELECT_REPORT_TEXT)[1].click();

    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    const { reportName } = mockPerformanceReportFolders[0];

    screen.getByText(reportName).click();

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(reportName),
        WAIT_FOR_OPTIONS,
    );

    expect(getAllButtonsWithText(reportName)).toHaveLength(1);
    expect(getAllButtonsWithText(SELECT_REPORT_TEXT)).toHaveLength(1);
});

it('handles invalid memory report upload', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    const mockDb = new File([''], 'wrong.sqlite', { type: 'text/x-sqlite3' });
    Object.defineProperty(mockDb, 'webkitRelativePath', {
        value: 'mock_folder/wrong.sqlite',
        writable: false,
    });

    const mockConfig = new File([''], 'nope.json', { type: 'application/json' });
    Object.defineProperty(mockConfig, 'webkitRelativePath', {
        value: 'mock_folder/nope.json',
        writable: false,
    });

    const input = screen.getByTestId(TEST_IDS.LOCAL_PROFILER_UPLOAD);

    fireEvent.change(input, { target: { files: [mockDb, mockConfig] } });

    await waitFor(
        () =>
            expect(screen.getByTestId(TEST_IDS.LOCAL_PROFILER_STATUS).textContent).to.equal(
                'Selected directory does not contain a valid report',
            ),
        WAIT_FOR_OPTIONS,
    );

    expect(getAllButtonsWithText(SELECT_REPORT_TEXT)).toHaveLength(2);
});

it('handles valid memory report upload', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    const mockDb = new File([''], 'db.sqlite', { type: 'text/x-sqlite3' });
    Object.defineProperty(mockDb, 'webkitRelativePath', {
        value: 'mock_folder/db.sqlite',
        writable: false,
    });

    const mockConfig = new File([''], 'config.json', { type: 'application/json' });
    Object.defineProperty(mockConfig, 'webkitRelativePath', {
        value: 'mock_folder/config.json',
        writable: false,
    });

    const input = screen.getByTestId(TEST_IDS.LOCAL_PROFILER_UPLOAD);

    expect(input.nextElementSibling?.textContent).to.equal('Choose directory...');

    fireEvent.change(input, { target: { files: [mockDb, mockConfig] } });

    await waitFor(
        () =>
            expect(screen.getByTestId(TEST_IDS.LOCAL_PROFILER_STATUS).textContent).to.equal(
                'Files uploaded successfully',
            ),
        WAIT_FOR_OPTIONS,
    );

    await waitFor(() => expect(input.nextElementSibling?.textContent).to.equal('2 files uploaded'), WAIT_FOR_OPTIONS);

    const { reportName } = mockProfilerFolderList[0];
    expect(getAllButtonsWithText(reportName)).toHaveLength(1);
    expect(getAllButtonsWithText(SELECT_REPORT_TEXT)).toHaveLength(1);
});

it('handles invalid performance report upload', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    const mockDb = new File([''], 'db.sqlite', { type: 'text/x-sqlite3' });
    Object.defineProperty(mockDb, 'webkitRelativePath', {
        value: 'mock_folder/db.sqlite',
        writable: false,
    });

    const mockConfig = new File([''], 'config.json', { type: 'application/json' });
    Object.defineProperty(mockConfig, 'webkitRelativePath', {
        value: 'mock_folder/config.json',
        writable: false,
    });

    const input = screen.getByTestId(TEST_IDS.LOCAL_PERFORMANCE_UPLOAD);

    fireEvent.change(input, { target: { files: [mockDb, mockConfig] } });

    await waitFor(
        () =>
            expect(screen.getByTestId(TEST_IDS.LOCAL_PERFORMANCE_STATUS).textContent).to.equal(
                'Selected directory is not a valid profiler run',
            ),
        WAIT_FOR_OPTIONS,
    );
});

it('handles valid performance report upload', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    const parentFolder = 'llama_mlp_tracy';
    const mockTracy = new File([''], 'tracy_profile_log_host.tracy', { type: 'text/tracy' });
    Object.defineProperty(mockTracy, 'webkitRelativePath', {
        value: `${parentFolder}/tracy_profile_log_host.tracy`,
        writable: false,
    });

    const mockOps = new File([''], 'ops_perf_results_2025_05_02_01_23_09.csv', { type: 'text/csv' });
    Object.defineProperty(mockOps, 'webkitRelativePath', {
        value: `${parentFolder}/ops_perf_results_2025_05_02_01_23_09.csv`,
        writable: false,
    });

    const mockDevice = new File([''], 'profile_log_device.csv', { type: 'text/csv' });
    Object.defineProperty(mockDevice, 'webkitRelativePath', {
        value: `${parentFolder}/profile_log_device.csv`,
        writable: false,
    });

    const input = screen.getByTestId(TEST_IDS.LOCAL_PERFORMANCE_UPLOAD);

    expect(input.nextElementSibling?.textContent).to.equal('Choose directory...');

    fireEvent.change(input, { target: { files: [mockTracy, mockOps, mockDevice] } });

    await waitFor(() => expect(input.nextElementSibling?.textContent).to.equal('3 files selected'), WAIT_FOR_OPTIONS);

    await waitFor(
        () =>
            expect(screen.getByTestId(TEST_IDS.LOCAL_PERFORMANCE_STATUS).textContent).to.equal(
                'Files uploaded successfully',
            ),
        WAIT_FOR_OPTIONS,
    );

    await waitFor(() => expect(input.nextElementSibling?.textContent).to.equal('3 files uploaded'), WAIT_FOR_OPTIONS);

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(parentFolder),
        WAIT_FOR_OPTIONS,
    );

    expect(getAllButtonsWithText(parentFolder)).toHaveLength(1);
    expect(getAllButtonsWithText(SELECT_REPORT_TEXT)).toHaveLength(1);
});

it('deletes memory report and updates state', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    getAllButtonsWithText(SELECT_REPORT_TEXT)[0].click();

    await waitFor(testForPortal, WAIT_FOR_OPTIONS); // Select menu is rendered in a portal

    const { reportName } = mockProfilerFolderList[0];
    screen.getAllByLabelText('Delete report')[0].click();

    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBe(null), WAIT_FOR_OPTIONS);

    const deleteAlertButtons: NodeListOf<HTMLButtonElement> = document.querySelectorAll('[role="alertdialog"] button');

    deleteAlertButtons[0].click();

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(reportName),
        WAIT_FOR_OPTIONS,
    );

    // Verify UI updated - instance is not updated in this test
    // expect(getAllButtonsWithText(reportName)).toHaveLength(1);
    // expect(getAllButtonsWithText(SELECT_REPORT_TEXT)).toHaveLength(1);
});
