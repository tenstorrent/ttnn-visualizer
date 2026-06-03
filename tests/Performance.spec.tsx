// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAtom, useSetAtom } from 'jotai';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Performance from '../src/routes/Performance';
import {
    useOpToPerfIdFiltered,
    usePerfFolderList,
    usePerformanceComparisonReport,
    usePerformanceRange,
    usePerformanceReport,
} from '../src/hooks/useAPI';
import { activePerformanceReportAtom, selectedPerfRowIdAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useOpToPerfIdFiltered: vi.fn(),
    usePerfFolderList: vi.fn(),
    usePerformanceComparisonReport: vi.fn(),
    usePerformanceRange: vi.fn(),
    usePerformanceReport: vi.fn(),
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => ({ SERVER_MODE: true }),
}));

const REPORT_A = { path: '/reports/a', reportName: 'report-a' };
const REPORT_B = { path: '/reports/b', reportName: 'report-b' };
const SELECTED_ROW_ID = 100;

afterEach(cleanup);

beforeEach(() => {
    // Keep Performance in its loading-spinner early-return path so the test does
    // not have to mount the full table/chart subtree. Effects still run after
    // commit, which is exactly what we want to exercise.
    (usePerformanceReport as Mock).mockReturnValue({ data: undefined, isLoading: true, error: null });
    (usePerformanceComparisonReport as Mock).mockReturnValue({ data: undefined });
    (usePerfFolderList as Mock).mockReturnValue({ data: undefined });
    (usePerformanceRange as Mock).mockReturnValue(null);
    (useOpToPerfIdFiltered as Mock).mockReturnValue([]);
});

function PerformanceController() {
    const [selected, setSelected] = useAtom(selectedPerfRowIdAtom);
    const setReport = useSetAtom(activePerformanceReportAtom);

    return (
        <div>
            <span data-testid='selected-row-probe'>{selected === null ? 'null' : String(selected)}</span>
            <button
                type='button'
                data-testid='select-row'
                onClick={() => setSelected(SELECTED_ROW_ID)}
            >
                select
            </button>
            <button
                type='button'
                data-testid='set-report-a'
                onClick={() => setReport(REPORT_A)}
            >
                a
            </button>
            <button
                type='button'
                data-testid='set-report-b'
                onClick={() => setReport(REPORT_B)}
            >
                b
            </button>
        </div>
    );
}

describe('Performance route', () => {
    it('clears selectedPerfRowIdAtom when the active performance report changes', () => {
        render(
            <TestProviders>
                <Performance />
                <PerformanceController />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));

        fireEvent.click(screen.getByTestId('select-row'));
        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent(String(SELECTED_ROW_ID));

        fireEvent.click(screen.getByTestId('set-report-b'));

        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent('null');
    });

    it('does not re-clear selectedPerfRowIdAtom while the active report is unchanged', () => {
        render(
            <TestProviders>
                <Performance />
                <PerformanceController />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));
        fireEvent.click(screen.getByTestId('select-row'));
        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent(String(SELECTED_ROW_ID));

        fireEvent.click(screen.getByTestId('set-report-a'));

        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent(String(SELECTED_ROW_ID));
    });
});
