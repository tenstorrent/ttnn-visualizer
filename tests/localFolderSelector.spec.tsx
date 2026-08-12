// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Classes } from '@blueprintjs/core';
import { HttpStatusCode } from 'axios';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestProviders } from './helpers/TestProviders';
import getAllButtonsWithText from './helpers/getAllButtonsWithText';
import mockInstanceEmpty from './data/mockInstanceEmpty.json';
import mockProfilerFolderList from './data/mockProfilerFolderList.json';
import mockPerformanceReportFolders from './data/mockPerformanceReportFolders.json';
import { ReportFolder } from '../src/definitions/Reports';
import LocalFolderSelector from '../src/components/report-selection/LocalFolderSelector';
import { CONFIRM_DELETE_LABEL, ManagedEntity } from '../src/definitions/ManagedEntity';
import {
    MEMORY_REPORT_DELETED_TOAST_TITLE,
    MEMORY_REPORT_DELETE_FAILED_TOAST_TITLE,
    PERFORMANCE_REPORT_DELETED_TOAST_TITLE,
    PERFORMANCE_REPORT_DELETE_FAILED_TOAST_TITLE,
} from '../src/definitions/notifyActiveReport';
import { TEST_IDS } from '../src/definitions/TestIds';
import { getDeleteActionLabel } from '../src/functions/managedEntityLabels';
import { isActivatingReportAtom } from '../src/store/app';
import testForPortal from './helpers/testForPortal';
import createMockFile, { MOCK_FOLDER } from './helpers/createMockFile';

// Scrub the markup after each test
const WAIT_FOR_OPTIONS = { timeout: 1000 };
const SELECT_REPORT_TEXT = 'Select a report...';

// Data is mutated in the mock of useLocal - eventually this should be set per test as needed
const mockPerfFolderList = [...mockPerformanceReportFolders];

// The folder list is the mocked query's only source of truth, so deleting has to remove from it
// for anything downstream of the delete to be observable.
const { mockUpdateInstance, mockDeleteProfiler, mockDeletePerformance, mockProfilerFolders } = vi.hoisted(() => ({
    mockUpdateInstance: vi.fn(),
    mockDeleteProfiler: vi.fn(),
    mockDeletePerformance: vi.fn(),
    mockProfilerFolders: [] as { path: string; reportName: string }[],
}));

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
        useReportFolderList: () => ({ data: mockProfilerFolders }),
        updateInstance: (...args: unknown[]) => mockUpdateInstance(...args),
        deleteProfiler: (...args: unknown[]) => mockDeleteProfiler(...args),
        deletePerformance: (...args: unknown[]) => mockDeletePerformance(...args),
    };
});

const defaultUpdateInstance = (updates: {
    active_report?: { profiler_name?: string | { path: string }; performance_name?: string | { path: string } };
}) => {
    const updatedInstance: Record<string, unknown> = {
        ...mockInstanceEmpty,
        ...updates,
    };

    if (updates.active_report?.profiler_name) {
        const profilerName = updates.active_report.profiler_name;
        const path = typeof profilerName === 'string' ? profilerName : profilerName.path;
        updatedInstance.profiler_path = `/data/local/profiler-reports/${path}`;
    }

    if (updates.active_report?.performance_name) {
        const performanceName = updates.active_report.performance_name;
        const path = typeof performanceName === 'string' ? performanceName : performanceName.path;
        updatedInstance.performance_path = `/data/local/performance-reports/${path}`;
    }

    return Promise.resolve(updatedInstance);
};

afterEach(() => {
    cleanup();
    mockUpdateInstance.mockReset();
    mockUpdateInstance.mockImplementation(defaultUpdateInstance);
});

beforeEach(() => {
    // Restore both lists in place: the mock factories closed over these array references.
    mockProfilerFolders.splice(0, mockProfilerFolders.length, ...mockProfilerFolderList);
    mockPerfFolderList.splice(0, mockPerfFolderList.length, ...mockPerformanceReportFolders);
    mockDeletePerformance.mockReset();
    mockDeletePerformance.mockImplementation((path: string) => {
        const folderIndex = mockPerfFolderList.findIndex((folder) => folder.path === path);

        if (folderIndex !== -1) {
            mockPerfFolderList.splice(folderIndex, 1);
        }

        return Promise.resolve({ success: true });
    });
    mockDeleteProfiler.mockReset();
    mockDeleteProfiler.mockImplementation((path: string) => {
        const folderIndex = mockProfilerFolders.findIndex((folder) => folder.path === path);

        if (folderIndex !== -1) {
            mockProfilerFolders.splice(folderIndex, 1);
        }

        return Promise.resolve({ success: true });
    });
});

mockUpdateInstance.mockImplementation(defaultUpdateInstance);

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

it('disables local report selectors and shows a loading spinner while an active report is being confirmed', () => {
    render(
        <TestProviders initialAtomValues={[[isActivatingReportAtom, true]]}>
            <LocalFolderSelector />
        </TestProviders>,
    );

    getAllButtonsWithText(SELECT_REPORT_TEXT).forEach((button) => {
        expect(button).toHaveProperty('disabled', true);
        expect(button.classList.contains(Classes.LOADING)).toBe(true);
    });
});

it('shows a loading spinner while updateInstance is pending then clears it', async () => {
    let resolveUpdate: ((value: unknown) => void) | undefined;
    mockUpdateInstance.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                resolveUpdate = resolve;
            }),
    );

    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    getAllButtonsWithText(SELECT_REPORT_TEXT)[0].click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    const { reportName } = mockProfilerFolderList[0];
    screen.getByText(reportName).click();

    await waitFor(() => {
        getAllButtonsWithText(SELECT_REPORT_TEXT).forEach((button) => {
            expect(button).toHaveProperty('disabled', true);
            expect(button.classList.contains(Classes.LOADING)).toBe(true);
        });
    }, WAIT_FOR_OPTIONS);

    expect(resolveUpdate).toBeDefined();
    resolveUpdate!(mockInstanceEmpty);

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(reportName),
        WAIT_FOR_OPTIONS,
    );

    await waitFor(() => {
        const activeButton = getAllButtonsWithText(reportName)[0];
        expect(activeButton).toHaveProperty('disabled', false);
        expect(activeButton.classList.contains(Classes.LOADING)).toBe(false);
    }, WAIT_FOR_OPTIONS);
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

    const { path } = mockPerformanceReportFolders[0];

    screen.getByText(new RegExp(path, 'i')).click();

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(path),
        WAIT_FOR_OPTIONS,
    );

    expect(getAllButtonsWithText(path)).toHaveLength(1);
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

    const input = screen.getByTestId(TEST_IDS.LOCAL_PROFILER_UPLOAD);

    expect(input.nextElementSibling?.textContent).to.equal('Choose directory...');

    fireEvent.change(input, { target: { files: [mockDb] } });

    await waitFor(
        () =>
            expect(screen.getByTestId(TEST_IDS.LOCAL_PROFILER_STATUS).textContent).to.equal(
                'Files uploaded successfully',
            ),
        WAIT_FOR_OPTIONS,
    );

    await waitFor(() => expect(input.nextElementSibling?.textContent).to.equal('1 files uploaded'), WAIT_FOR_OPTIONS);

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
                'Selected directory does not contain a valid report',
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

it('handles valid performance report upload without tracy', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );

    const mockOps = createMockFile('ops_perf_results_2025_05_02_01_23_09.csv', 'text/csv');
    const mockDevice = createMockFile('profile_log_device.csv', 'text/csv');

    const input = screen.getByTestId(TEST_IDS.LOCAL_PERFORMANCE_UPLOAD);

    fireEvent.change(input, { target: { files: [mockOps, mockDevice] } });

    await waitFor(() => expect(input.nextElementSibling?.textContent).to.equal('2 files selected'), WAIT_FOR_OPTIONS);

    await waitFor(
        () =>
            expect(screen.getByTestId(TEST_IDS.LOCAL_PERFORMANCE_STATUS).textContent).to.equal(
                'Files uploaded successfully',
            ),
        WAIT_FOR_OPTIONS,
    );

    await waitFor(() => expect(input.nextElementSibling?.textContent).to.equal('2 files uploaded'), WAIT_FOR_OPTIONS);

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(MOCK_FOLDER),
        WAIT_FOR_OPTIONS,
    );
});

it('deletes memory report and updates state', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );
    const deletedFolder = mockProfilerFolderList[0];
    const profilerSelect = getAllButtonsWithText(SELECT_REPORT_TEXT)[0];

    profilerSelect.click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);
    mockProfilerFolderList.forEach((folder: ReportFolder) => {
        expect(screen.getByText(folder.reportName)).not.toBeNull();
        expect(screen.getByText(`/${folder.path}`)).not.toBeNull();
    });

    fireEvent.click(screen.getByLabelText(getDeleteActionLabel(ManagedEntity.REPORT, deletedFolder.reportName)));

    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBe(null), WAIT_FOR_OPTIONS);

    fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(deletedFolder.reportName),
        WAIT_FOR_OPTIONS,
    );

    expect(screen.getByText(MEMORY_REPORT_DELETED_TOAST_TITLE)).not.toBeNull();
    expect(mockDeleteProfiler).toHaveBeenCalledTimes(1);
    expect(mockDeleteProfiler).toHaveBeenCalledWith(deletedFolder.path);
    expect(getAllButtonsWithText(SELECT_REPORT_TEXT)).toHaveLength(2);

    profilerSelect.click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    // Scoped to the dropdown rows: the delete toast is still on screen and carries the report name
    // too, so an unscoped query would match it and hide the row's disappearance.
    const menuRows = screen.getAllByTestId(TEST_IDS.FOLDER_PICKER_ROW).map((row) => row.textContent);

    expect(menuRows).toHaveLength(mockProfilerFolderList.length - 1);
    expect(menuRows.some((row) => row?.includes(`/${deletedFolder.path}`))).toBe(false);

    mockProfilerFolders.forEach((folder) => {
        expect(menuRows.some((row) => row?.includes(`/${folder.path}`) && row?.includes(folder.reportName))).toBe(true);
    });
});

it('deletes performance report and updates state', async () => {
    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );
    const deletedFolder = mockPerfFolderList[0];
    const performanceSelect = getAllButtonsWithText(SELECT_REPORT_TEXT)[1];

    performanceSelect.click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    fireEvent.click(screen.getByLabelText(getDeleteActionLabel(ManagedEntity.REPORT, deletedFolder.reportName)));

    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBe(null), WAIT_FOR_OPTIONS);

    fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(deletedFolder.reportName),
        WAIT_FOR_OPTIONS,
    );

    expect(screen.getByText(PERFORMANCE_REPORT_DELETED_TOAST_TITLE)).not.toBeNull();
    expect(mockDeletePerformance).toHaveBeenCalledTimes(1);
    expect(mockDeletePerformance).toHaveBeenCalledWith(deletedFolder.path);

    performanceSelect.click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    // Scoped to the dropdown rows: the delete toast is still on screen and carries the report name
    // too, so an unscoped query would match it and hide the row's disappearance.
    const menuRows = screen.getAllByTestId(TEST_IDS.FOLDER_PICKER_ROW).map((row) => row.textContent);

    expect(menuRows).toHaveLength(mockPerformanceReportFolders.length - 1);
    expect(menuRows.some((row) => row?.includes(`/${deletedFolder.path}`))).toBe(false);
});

// A stand-in for whatever the server puts in the 403's `error` field, not a copy of it — the
// backend's exact wording is pinned where it is defined (test_report_deletion.py asserts against
// the imported constant). What these tests pin is the plumbing: server `error` reaches the toast.
const SERVER_ERROR_DETAIL = 'Reports in the TT-Metal tree are not managed here';

/** Shaped like the AxiosError a refused DELETE actually rejects with, which is the branch of
 *  getResponseError the handlers depend on — a bare Error takes a different path. */
const refusedDelete = () => ({
    isAxiosError: true,
    response: { status: HttpStatusCode.Forbidden, data: { error: SERVER_ERROR_DETAIL } },
});

/** Opens the picker, deletes the named report through the confirmation, and waits for the toast. */
async function confirmDeleteOf(select: HTMLElement, folder: ReportFolder) {
    select.click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    fireEvent.click(screen.getByLabelText(getDeleteActionLabel(ManagedEntity.REPORT, folder.reportName)));

    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBe(null), WAIT_FOR_OPTIONS);

    fireEvent.click(screen.getByRole('button', { name: CONFIRM_DELETE_LABEL }));

    // The failure is what the user sees — without this the delete is silent.
    await waitFor(
        () => expect(screen.getByTestId(TEST_IDS.TOAST_FILENAME).textContent).to.contain(SERVER_ERROR_DETAIL),
        WAIT_FOR_OPTIONS,
    );
}

it('surfaces an error toast and keeps the report when the memory delete fails', async () => {
    mockDeleteProfiler.mockRejectedValueOnce(refusedDelete());

    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );
    const deletedFolder = mockProfilerFolderList[0];
    const profilerSelect = getAllButtonsWithText(SELECT_REPORT_TEXT)[0];

    await confirmDeleteOf(profilerSelect, deletedFolder);

    expect(screen.getByText(MEMORY_REPORT_DELETE_FAILED_TOAST_TITLE)).not.toBeNull();

    profilerSelect.click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    const menuRows = screen.getAllByTestId(TEST_IDS.FOLDER_PICKER_ROW).map((row) => row.textContent);

    expect(menuRows).toHaveLength(mockProfilerFolderList.length);
    expect(menuRows.some((row) => row?.includes(`/${deletedFolder.path}`))).toBe(true);
});

it('surfaces an error toast and keeps the report when the performance delete fails', async () => {
    mockDeletePerformance.mockRejectedValueOnce(refusedDelete());

    render(
        <TestProviders>
            <LocalFolderSelector />
        </TestProviders>,
    );
    const deletedFolder = mockPerfFolderList[0];
    const performanceSelect = getAllButtonsWithText(SELECT_REPORT_TEXT)[1];

    await confirmDeleteOf(performanceSelect, deletedFolder);

    expect(screen.getByText(PERFORMANCE_REPORT_DELETE_FAILED_TOAST_TITLE)).not.toBeNull();
    expect(mockDeletePerformance).toHaveBeenCalledWith(deletedFolder.path);

    performanceSelect.click();
    await waitFor(testForPortal, WAIT_FOR_OPTIONS);

    const menuRows = screen.getAllByTestId(TEST_IDS.FOLDER_PICKER_ROW).map((row) => row.textContent);

    expect(menuRows).toHaveLength(mockPerformanceReportFolders.length);
    expect(menuRows.some((row) => row?.includes(`/${deletedFolder.path}`))).toBe(true);
});
