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
import createMockFile, { MOCK_FOLDER } from './helpers/createMockFile';

// Scrub the markup after each test
afterEach(cleanup);

const WAIT_FOR_OPTIONS = { timeout: 1000 };
const SELECT_REPORT_TEXT = 'Select a report...';

// Data is mutated in the mock of useLocal - eventually this should be set per test as needed
const mockPerfFolderList = [...mockPerformanceReportFolders];

vi.mock('../src/hooks/useLocal', async () => {
    const actual = await import('../src/hooks/useLocal');

    return {
        default: () => ({
            ...actual.default(),
            uploadLocalFolder: vi.fn().mockResolvedValue({ status: 200, data: mockProfilerFolderList[0] }),
            uploadLocalPerformanceFolder: vi.fn().mockImplementation(() => {
                // Add the uploaded folder to the mock list
                const uploadedFolder = { path: MOCK_FOLDER, reportName: MOCK_FOLDER };
                if (!mockPerfFolderList.some((f) => f.path === MOCK_FOLDER)) {
                    mockPerfFolderList.push(uploadedFolder);
                }
                return {
                    status: 200,
                    data: {
                        status: 3,
                        detail: null,
                        message: 'success',
                    },
                };
            }),
        }),
    };
});

vi.mock('../src/hooks/useAPI', async () => {
    const actual = await import('../src/hooks/useAPI');

    return {
        ...actual,
        useGetClusterDescription: () => ({ data: null }),
        usePerfFolderList: () => ({ data: mockPerfFolderList }),
        useInstance: () => ({ data: mockInstanceEmpty }),
        useReportFolderList: () => ({ data: mockProfilerFolderList }),
        updateInstance: vi.fn().mockImplementation((updates) => {
            // Return instance with the updates applied
            const updatedInstance = {
                ...mockInstanceEmpty,
                ...updates,
            };

            // If it's a profiler report, set the profiler_path
            if (updates.active_report?.profiler_name) {
                updatedInstance.profiler_path = `/data/local/profiler-reports/${updates.active_report.profiler_name.path}`;
            }

            // If it's a performance report, set the performance_path
            if (updates.active_report?.performance_name) {
                updatedInstance.performance_path = `/data/local/performance-reports/${updates.active_report.performance_name.path}`;
            }

            return Promise.resolve(updatedInstance);
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

    const mockDb = createMockFile('wrong.sqlite', 'text/x-sqlite3');
    const mockConfig = createMockFile('nope.json', 'application/json');

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

    const mockDb = createMockFile('db.sqlite', 'text/x-sqlite3');
    const mockConfig = createMockFile('config.json', 'application/json');

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

    const mockDb = createMockFile('db.sqlite', 'text/x-sqlite3');
    const mockConfig = createMockFile('config.json', 'application/json');

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

    const mockTracy = createMockFile('tracy_profile_log_host.tracy', 'text/tracy');
    const mockOps = createMockFile('ops_perf_results_2025_05_02_01_23_09.csv', 'text/csv');
    const mockDevice = createMockFile('profile_log_device.csv', 'text/csv');

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
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(MOCK_FOLDER),
        WAIT_FOR_OPTIONS,
    );

    expect(getAllButtonsWithText(MOCK_FOLDER)).toHaveLength(1);
    expect(getAllButtonsWithText(SELECT_REPORT_TEXT)).toHaveLength(1);
});

// Skipped test: Deletion test to be fixed in future PR
it.skip('deletes memory report and updates state', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );
    const { reportName } = mockProfilerFolderList[0];
    const profilerSelect = getAllButtonsWithText(SELECT_REPORT_TEXT)[0];

    profilerSelect.click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
    mockProfilerFolderList.forEach((folder: ReportFolder) => {
        expect(screen.getByText(folder.reportName)).not.toBeNull();
        expect(screen.getByText(`/${folder.path}`)).not.toBeNull();
    });
    screen.getAllByLabelText('Delete report')[0].click();

    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBe(null), WAIT_FOR_OPTIONS);

    const deleteAlertButtons: NodeListOf<HTMLButtonElement> = document.querySelectorAll('[role="alertdialog"] button');

    deleteAlertButtons[0].click();

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(reportName),
        WAIT_FOR_OPTIONS,
    );

    expect(getAllButtonsWithText(SELECT_REPORT_TEXT)).toHaveLength(2);
    profilerSelect.click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
    mockProfilerFolderList.forEach((folder: ReportFolder) => {
        expect(screen.getByText(folder.reportName)).not.toBeNull();
        expect(screen.getByText(`/${folder.path}`)).not.toBeNull();
    });
});
