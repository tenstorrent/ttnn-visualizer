// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComparisonReportSelector from '../src/components/performance/ComparisonReportSelector';
import { ReportFolder } from '../src/definitions/Reports';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../src/store/app';
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/functions/recordEvent', () => ({ default: vi.fn() }));

// Stands in for the folder picker: lists the rows it is offered, and picks one by path.
vi.mock('../src/components/report-selection/LocalFolderPicker', () => ({
    default: ({ items, handleSelect }: { items: ReportFolder[]; handleSelect: (folder: ReportFolder) => void }) => (
        <ul data-testid='offered-reports'>
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
    ),
}));

const LOCAL_FOLDERS: ReportFolder[] = [
    { path: 'report-a', reportName: 'report-a' },
    { path: 'report-b', reportName: 'report-b' },
    { path: 'report-c', reportName: 'report-c' },
];

function ComparisonListProbe() {
    const comparisonReports = useAtomValue(comparisonPerformanceReportListAtom);

    return <span data-testid='comparison-list-probe'>{JSON.stringify(comparisonReports)}</span>;
}

function renderSelector({
    activeReport,
    comparisonReports = null,
    folderList = LOCAL_FOLDERS,
    reportIndex = 0,
}: {
    activeReport: ReportFolder;
    comparisonReports?: string[] | null;
    folderList?: ReportFolder[];
    reportIndex?: number;
}) {
    const initialAtomValues: AtomProviderInitialValues = [[activePerformanceReportAtom, activeReport]];

    if (comparisonReports) {
        initialAtomValues.push([comparisonPerformanceReportListAtom, comparisonReports]);
    }

    return render(
        <TestProviders initialAtomValues={initialAtomValues}>
            <ComparisonReportSelector
                folderList={folderList}
                reportIndex={reportIndex}
            />
            <ComparisonListProbe />
        </TestProviders>,
    );
}

const offeredReports = () =>
    within(screen.getByTestId('offered-reports'))
        .queryAllByRole('button')
        .map((button) => button.textContent);

afterEach(cleanup);

describe('ComparisonReportSelector', () => {
    it('does not offer the active report', () => {
        renderSelector({ activeReport: { path: 'report-a', reportName: 'report-a' } });

        expect(offeredReports()).toEqual(['report-b', 'report-c']);
    });

    it('does not offer the active report after a fresh remote pick, which holds the remote path', () => {
        renderSelector({
            activeReport: { path: '/remote/reports/report-a', reportName: 'report-a', syncedName: 'report-a' },
        });

        expect(offeredReports()).toEqual(['report-b', 'report-c']);
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

        expect(screen.getByTestId('comparison-list-probe')).toHaveTextContent('["run_rank1"]');
    });
});
