// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComparisonReportSelector from '../src/components/performance/ComparisonReportSelector';
import { ReportFolder } from '../src/definitions/Reports';
import { formatSyncedReportName } from '../src/functions/reportRank';
import {
    activePerformanceReportAtom,
    comparisonPerformanceReportDirectoryAtom,
    comparisonPerformanceReportListAtom,
} from '../src/store/app';
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { COMPARISON_LIST_PROBE_TEST_ID, ComparisonListProbe } from './helpers/ComparisonListProbe';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/functions/recordEvent', () => ({ default: vi.fn() }));

const OFFERED_REPORTS_LABEL = 'Offered reports';
const PICKER_SELECTION_LABEL = 'Picker selection';

// Stands in for the folder picker: lists the rows it is offered, picks one by path, and
// shows the value and label it was handed for the selected row.
vi.mock('../src/components/report-selection/LocalFolderPicker', () => ({
    default: ({
        items,
        value,
        valueLabel,
        handleSelect,
    }: {
        items: ReportFolder[];
        value: string | null;
        valueLabel: string | null;
        handleSelect: (folder: ReportFolder) => void;
    }) => (
        <>
            <output
                aria-label={PICKER_SELECTION_LABEL}
                data-value={value ?? ''}
            >
                {valueLabel}
            </output>
            <ul aria-label={OFFERED_REPORTS_LABEL}>
                {items.map((folder) => (
                    <li key={folder.path}>
                        <button
                            type='button'
                            onClick={() => handleSelect(folder)}
                        >
                            {folder.path}
                        </button>
                    </li>
                ))}
            </ul>
        </>
    ),
}));

const LOCAL_FOLDERS: ReportFolder[] = [
    { path: 'report-a', reportName: 'report-a' },
    { path: 'report-b', reportName: 'report-b' },
    { path: 'report-c', reportName: 'report-c' },
];
const LOCAL_DIRECTORY = '/reports';

function renderSelector({
    activeReport,
    comparisonReports = null,
    comparisonDirectory = LOCAL_DIRECTORY,
    folderList = LOCAL_FOLDERS,
    reportIndex = 0,
}: {
    activeReport: ReportFolder;
    comparisonReports?: string[] | null;
    comparisonDirectory?: string;
    folderList?: ReportFolder[];
    reportIndex?: number;
}) {
    const initialAtomValues: AtomProviderInitialValues = [[activePerformanceReportAtom, activeReport]];

    if (comparisonReports) {
        initialAtomValues.push([comparisonPerformanceReportListAtom, comparisonReports]);
        initialAtomValues.push([comparisonPerformanceReportDirectoryAtom, comparisonDirectory]);
    }

    return render(
        <TestProviders initialAtomValues={initialAtomValues}>
            <ComparisonReportSelector
                folderList={folderList}
                directory={LOCAL_DIRECTORY}
                reportIndex={reportIndex}
            />
            <ComparisonListProbe />
        </TestProviders>,
    );
}

const offeredReports = () =>
    within(screen.getByRole('list', { name: OFFERED_REPORTS_LABEL }))
        .queryAllByRole('button')
        .map((button) => button.textContent);

afterEach(cleanup);

describe('ComparisonReportSelector', () => {
    it('starts the list again when the earlier picks came from another directory (#2433)', () => {
        renderSelector({
            activeReport: { path: 'report-a', reportName: 'report-a' },
            comparisonReports: ['report-c'],
            comparisonDirectory: '/synced/remote-host',
            reportIndex: 1,
        });

        fireEvent.click(screen.getByRole('button', { name: 'report-b' }));

        expect(screen.getByTestId(COMPARISON_LIST_PROBE_TEST_ID)).toHaveTextContent('["report-b"]');
    });

    it('does not offer the active report', () => {
        renderSelector({ activeReport: { path: 'report-a', reportName: 'report-a' } });

        expect(offeredReports()).toEqual(['report-b', 'report-c']);
    });

    it('does not offer the active report after a fresh remote pick, which holds the remote path', () => {
        // A multihost rank: the folder id is the synced name, and the display name has no rank.
        renderSelector({
            activeReport: { path: '/remote/reports/run', reportName: 'run', syncedName: 'run_rank1' },
            folderList: [
                { path: 'run_rank1', reportName: 'run_rank1' },
                { path: 'run', reportName: 'run' },
            ],
        });

        expect(offeredReports()).toEqual(['run']);
    });

    it('does not offer a report already chosen in another selector', () => {
        renderSelector({
            activeReport: { path: 'report-a', reportName: 'report-a' },
            comparisonReports: ['report-b'],
            reportIndex: 1,
        });

        expect(offeredReports()).toEqual(['report-c']);
    });

    it('still offers the report already chosen in its own slot', () => {
        renderSelector({
            activeReport: { path: 'report-a', reportName: 'report-a' },
            comparisonReports: ['report-b'],
            reportIndex: 0,
        });

        expect(offeredReports()).toEqual(['report-b', 'report-c']);
    });

    it('stores the folder id rather than the display name', () => {
        // The listing never hands out a row like this today; it guards the rule that
        // the list holds what `?name=` addresses a report by.
        const rankedFolder: ReportFolder = { path: 'run_rank1', reportName: 'run' };

        renderSelector({
            activeReport: { path: 'report-a', reportName: 'report-a' },
            folderList: [rankedFolder],
        });

        fireEvent.click(screen.getByRole('button', { name: 'run_rank1' }));

        expect(screen.getByTestId(COMPARISON_LIST_PROBE_TEST_ID)).toHaveTextContent('["run_rank1"]');
    });

    it('hands the picker the stored folder id and its ranked label', () => {
        renderSelector({
            activeReport: { path: 'report-a', reportName: 'report-a' },
            comparisonReports: ['run_rank1'],
            folderList: [{ path: 'run_rank1', reportName: 'run_rank1' }],
        });

        const selection = screen.getByRole('status', { name: PICKER_SELECTION_LABEL });

        expect(selection).toHaveAttribute('data-value', 'run_rank1');
        expect(selection).toHaveTextContent(formatSyncedReportName('run_rank1'));
        // Guards against the label falling back to the raw id.
        expect(formatSyncedReportName('run_rank1')).not.toBe('run_rank1');
    });

    it('does not offer a row that has no usable folder id', () => {
        renderSelector({
            activeReport: { path: 'report-a', reportName: 'report-a' },
            folderList: [{ path: '/', reportName: 'root' }, ...LOCAL_FOLDERS],
        });

        expect(offeredReports()).toEqual(['report-b', 'report-c']);
    });
});
