// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAtom, useSetAtom } from 'jotai';
import { useState } from 'react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Performance from '../src/routes/Performance';
import {
    useL1PressureByOperation,
    useOpToPerfIdFiltered,
    usePerfFolderList,
    usePerformanceComparisonReport,
    usePerformanceRange,
    usePerformanceReport,
} from '../src/hooks/useAPI';
import {
    activePerformanceReportAtom,
    bufferTypeFilterListAtom,
    layoutFilterListAtom,
    mathFilterListAtom,
    rawOpCodeFilterListAtom,
    selectedPerfRowIdAtom,
} from '../src/store/app';
import { BufferType } from '../src/model/BufferType';
import { DeviceOperationLayoutTypes } from '../src/model/APIData';
import { L1PressureStatus } from '../src/functions/l1Pressure';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useL1PressureByOperation: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
    usePerfFolderList: vi.fn(),
    usePerformanceComparisonReport: vi.fn(),
    usePerformanceRange: vi.fn(),
    usePerformanceReport: vi.fn(),
}));

vi.mock('../src/functions/getServerConfig', () => ({
    default: () => ({ SERVER_MODE: true }),
}));

// Stub the report shell so these tests exercise only the route's own
// active-report effects, not PerfTable's selection cleanup effect (which would
// otherwise clear selectedPerfRowIdAtom while the skeleton is mounted).
vi.mock('../src/components/performance/PerfReport', () => ({
    default: () => <div data-testid='perf-report-stub' />,
}));

const REPORT_A = { path: '/reports/a', reportName: 'report-a' };
const REPORT_B = { path: '/reports/b', reportName: 'report-b' };
const SELECTED_ROW_ID = 100;
const MATH_FIDELITY = 'HiFi4';

afterEach(cleanup);

beforeEach(() => {
    // Loading state: the route keeps its shell mounted (no full-page spinner) and the
    // report shell is stubbed, so only the route's active-report effects run here.
    (usePerformanceReport as Mock).mockReturnValue({ data: undefined, isLoading: true, error: null });
    (usePerformanceComparisonReport as Mock).mockReturnValue({ data: undefined });
    (usePerfFolderList as Mock).mockReturnValue({ data: undefined });
    (usePerformanceRange as Mock).mockReturnValue(null);
    (useOpToPerfIdFiltered as Mock).mockReturnValue([]);
    (useL1PressureByOperation as Mock).mockReturnValue({ status: L1PressureStatus.Unavailable, data: null });
});

function formatFilterProbe(values: unknown[]): string {
    return values.length === 0 ? 'empty' : values.join(',');
}

function PerformanceController() {
    const [selected, setSelected] = useAtom(selectedPerfRowIdAtom);
    const [rawOpCodeFilterList, setRawOpCodeFilterList] = useAtom(rawOpCodeFilterListAtom);
    const [mathFilterList, setMathFilterList] = useAtom(mathFilterListAtom);
    const [bufferTypeFilterList, setBufferTypeFilterList] = useAtom(bufferTypeFilterListAtom);
    const [layoutFilterList, setLayoutFilterList] = useAtom(layoutFilterListAtom);
    const setReport = useSetAtom(activePerformanceReportAtom);

    return (
        <div>
            <span data-testid='selected-row-probe'>{selected === null ? 'null' : String(selected)}</span>
            <span data-testid='raw-op-code-filter-probe'>{formatFilterProbe(rawOpCodeFilterList)}</span>
            <span data-testid='math-filter-probe'>{formatFilterProbe(mathFilterList)}</span>
            <span data-testid='buffer-type-filter-probe'>{formatFilterProbe(bufferTypeFilterList)}</span>
            <span data-testid='layout-filter-probe'>{formatFilterProbe(layoutFilterList)}</span>
            <button
                type='button'
                data-testid='select-row'
                onClick={() => setSelected(SELECTED_ROW_ID)}
            >
                select
            </button>
            <button
                type='button'
                data-testid='set-all-filters'
                onClick={() => {
                    setRawOpCodeFilterList(['Matmul']);
                    setMathFilterList([MATH_FIDELITY]);
                    setBufferTypeFilterList([BufferType.L1]);
                    setLayoutFilterList([DeviceOperationLayoutTypes.INTERLEAVED]);
                }}
            >
                filter
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

    it('clears all table chip filters when the active performance report changes', () => {
        render(
            <TestProviders>
                <Performance />
                <PerformanceController />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));
        fireEvent.click(screen.getByTestId('set-all-filters'));
        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('Matmul');
        expect(screen.getByTestId('math-filter-probe')).toHaveTextContent(MATH_FIDELITY);
        expect(screen.getByTestId('buffer-type-filter-probe')).toHaveTextContent(String(BufferType.L1));
        expect(screen.getByTestId('layout-filter-probe')).toHaveTextContent(DeviceOperationLayoutTypes.INTERLEAVED);

        fireEvent.click(screen.getByTestId('set-report-b'));

        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('empty');
        expect(screen.getByTestId('math-filter-probe')).toHaveTextContent('empty');
        expect(screen.getByTestId('buffer-type-filter-probe')).toHaveTextContent('empty');
        expect(screen.getByTestId('layout-filter-probe')).toHaveTextContent('empty');
    });

    it('does not re-clear table chip filters while the active report is unchanged', () => {
        render(
            <TestProviders>
                <Performance />
                <PerformanceController />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));
        fireEvent.click(screen.getByTestId('set-all-filters'));
        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('Matmul');
        expect(screen.getByTestId('math-filter-probe')).toHaveTextContent(MATH_FIDELITY);

        fireEvent.click(screen.getByTestId('set-report-a'));

        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('Matmul');
        expect(screen.getByTestId('math-filter-probe')).toHaveTextContent(MATH_FIDELITY);
        expect(screen.getByTestId('buffer-type-filter-probe')).toHaveTextContent(String(BufferType.L1));
        expect(screen.getByTestId('layout-filter-probe')).toHaveTextContent(DeviceOperationLayoutTypes.INTERLEAVED);
    });

    it('does not clear table chip filters on Performance remount with the same report', () => {
        function RemountHarness() {
            const [routeKey, setRouteKey] = useState(0);

            return (
                <>
                    <Performance key={routeKey} />
                    <PerformanceController />
                    <button
                        type='button'
                        data-testid='remount-performance'
                        onClick={() => setRouteKey((key) => key + 1)}
                    >
                        remount
                    </button>
                </>
            );
        }

        render(
            <TestProviders>
                <RemountHarness />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));
        fireEvent.click(screen.getByTestId('set-all-filters'));
        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('Matmul');

        fireEvent.click(screen.getByTestId('remount-performance'));

        expect(screen.getByTestId('raw-op-code-filter-probe')).toHaveTextContent('Matmul');
        expect(screen.getByTestId('math-filter-probe')).toHaveTextContent(MATH_FIDELITY);
        expect(screen.getByTestId('buffer-type-filter-probe')).toHaveTextContent(String(BufferType.L1));
        expect(screen.getByTestId('layout-filter-probe')).toHaveTextContent(DeviceOperationLayoutTypes.INTERLEAVED);
    });

    it('does not clear selectedPerfRowIdAtom on Performance remount with the same report', () => {
        function RemountHarness() {
            const [routeKey, setRouteKey] = useState(0);

            return (
                <>
                    <Performance key={routeKey} />
                    <PerformanceController />
                    <button
                        type='button'
                        data-testid='remount-performance'
                        onClick={() => setRouteKey((key) => key + 1)}
                    >
                        remount
                    </button>
                </>
            );
        }

        render(
            <TestProviders>
                <RemountHarness />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId('set-report-a'));
        fireEvent.click(screen.getByTestId('select-row'));
        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent(String(SELECTED_ROW_ID));

        fireEvent.click(screen.getByTestId('remount-performance'));

        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent(String(SELECTED_ROW_ID));
    });
});
