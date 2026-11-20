// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PerformanceReport from '../src/components/performance/PerfReport';
import PerfTable from '../src/components/performance/PerfTable';
import {
    ColumnKeys,
    HARDWARE_COUNTER_COLUMN_KEYS,
    HardwareCounterColumns,
    comparisonKeys,
} from '../src/definitions/PerfTable';
import {
    HARDWARE_COUNTERS_SWITCH_HINT,
    HardwareCounterMeasure,
    NO_HARDWARE_COUNTERS_HINT,
    NO_HARDWARE_COUNTER_COLUMNS_HINT,
} from '../src/definitions/HardwareCounters';
import { OpType } from '../src/definitions/Performance';
import { EventLogEvent, PerfTableOption } from '../src/definitions/EventLogEvent';
import { TEST_IDS } from '../src/definitions/TestIds';
import {
    formatHardwareCounterValue,
    getHardwareCounterKeys,
    getHardwareCountersSwitchHint,
    hasHardwareCounterColumns,
} from '../src/functions/hardwareCounters';
import { getEligiblePerfColumns } from '../src/functions/perfTableColumns';
import { DEFAULT_MAX_CORES } from '../src/functions/getCoreCount';
import { useGetNPEManifest, useOpToPerfIdFiltered, useOperationsList, usePerfMeta } from '../src/hooks/useAPI';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { comparisonPerformanceReportListAtom, isStackedViewAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import { AtomProviderInitialValues } from './helpers/atomProvider';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetNPEManifest: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
    useOperationsList: vi.fn(),
    usePerfMeta: vi.fn(),
}));

const SWITCH_LABEL = 'Hardware counters';
const COMPARISON_REPORT = 'comparison-report';

const row = (id: number, counters: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        id,
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        advice: [],
        bound: null,
        total_percent: 50,
        device_time: 25.9,
        isFirstHashOccurrence: true,
        ...counters,
    }) as unknown as TypedPerfTableRow;

// A capture with the fpu group only: the backend adds no key for a column it lacks.
const counted = row(1, { hw_fpu_util: 9.396, hw_sfpu_util: 0, hw_math_util: 9.396, hw_grid_fpu_util: 5.994 });
const uncounted = row(2, { hw_fpu_util: null, hw_sfpu_util: null, hw_math_util: null, hw_grid_fpu_util: null });
const plain = row(3);
const busier = row(4, { hw_fpu_util: 50, hw_sfpu_util: 0, hw_math_util: 50, hw_grid_fpu_util: 25 });

const FPU_ONLY_KEYS = [
    ColumnKeys.HW_FPU_UTIL,
    ColumnKeys.HW_SFPU_UTIL,
    ColumnKeys.HW_MATH_UTIL,
    ColumnKeys.HW_GRID_FPU_UTIL,
];

const headers = () => screen.getAllByRole('columnheader').map((header) => header.textContent);

const hardwareCounterHeaders = () =>
    headers().filter((header) => HardwareCounterColumns.some((column) => column.name === header));

// Each data row's text under one column, in display order.
const columnCells = (name: string) => {
    const index = headers().indexOf(name);

    return Array.from(screen.getByRole('table').querySelectorAll('tbody tr')).map(
        (tableRow) => tableRow.querySelectorAll('td')[index]?.textContent ?? '',
    );
};

afterEach(cleanup);

beforeEach(() => {
    recordEvent.mockClear();
    (useGetNPEManifest as Mock).mockReturnValue({ data: [], error: null });
    (useOpToPerfIdFiltered as Mock).mockReturnValue([]);
    (useOperationsList as Mock).mockReturnValue({ data: [] });
    (usePerfMeta as Mock).mockReturnValue({ data: null, isLoading: false });
});

describe('hardware counter helpers', () => {
    it('finds the counter columns the rows carry', () => {
        expect([...getHardwareCounterKeys([plain, counted])]).toEqual(FPU_ONLY_KEYS);
        expect(getHardwareCounterKeys([plain]).size).toBe(0);
    });

    it("says whether the rows carry any of the table's counter columns", () => {
        expect(hasHardwareCounterColumns([plain, uncounted])).toBe(true);
        expect(hasHardwareCounterColumns([plain])).toBe(false);
        expect(hasHardwareCounterColumns([])).toBe(false);
    });

    it('says why the switch is off, telling a report without counters from one without these columns', () => {
        expect(getHardwareCountersSwitchHint(false, false)).toBe(NO_HARDWARE_COUNTERS_HINT);
        expect(getHardwareCountersSwitchHint(true, false)).toBe(NO_HARDWARE_COUNTER_COLUMNS_HINT);
        expect(getHardwareCountersSwitchHint(true, true)).toBe(HARDWARE_COUNTERS_SWITCH_HINT);
    });

    it('reads one list of counter columns for the table, its eligibility and its comparison rows', () => {
        expect([...HARDWARE_COUNTER_COLUMN_KEYS]).toEqual(HardwareCounterColumns.map((column) => column.key));
        expect([...comparisonKeys]).toEqual(expect.arrayContaining([...HARDWARE_COUNTER_COLUMN_KEYS]));
    });

    it('formats a percentage and a ratio apart', () => {
        expect(formatHardwareCounterValue(9.396, HardwareCounterMeasure.PERCENT)).toBe('9.4%');
        expect(formatHardwareCounterValue(0.61234, HardwareCounterMeasure.RATIO)).toBe('0.612');
    });
});

describe('the hardware counter column group', () => {
    const flags = {
        hasOpIds: false,
        hasL1PressureData: false,
        hiliteHighDispatch: false,
        hasNpe: false,
        hasSubDeviceIds: false,
        hasMultipleAvailableCoreBudgets: false,
    };

    it('offers none of its columns until asked', () => {
        const keys = getEligiblePerfColumns({ ...flags, hardwareCounterKeys: new Set() }).map((column) => column.key);

        expect(keys.filter((key) => HardwareCounterColumns.some((column) => column.key === key))).toEqual([]);
    });

    it('offers the columns the report has, after the kernel durations', () => {
        const keys = getEligiblePerfColumns({
            ...flags,
            hardwareCounterKeys: new Set(FPU_ONLY_KEYS),
        }).map((column) => column.key);
        const start = keys.indexOf(ColumnKeys.HW_FPU_UTIL);

        expect(keys.slice(start, start + FPU_ONLY_KEYS.length)).toEqual(FPU_ONLY_KEYS);
        expect(keys[start - 1]).toBe(ColumnKeys.EriscKernelDuration);
        expect(keys[start + FPU_ONLY_KEYS.length]).toBe(ColumnKeys.Hash);
        expect(keys).not.toContain(ColumnKeys.HW_PACKER_UTIL);
    });
});

describe('PerfTable with hardware counters', () => {
    const renderTable = (rows: TypedPerfTableRow[], showHardwareCounters?: boolean, comparison?: TypedPerfTableRow[]) =>
        render(
            <TestProviders>
                <PerfTable
                    data={rows}
                    comparisonData={comparison ? [comparison] : []}
                    filters={null}
                    provideMatmulAdvice={false}
                    hiliteHighDispatch={false}
                    reportFolderName='unit-test'
                    maxCores={DEFAULT_MAX_CORES}
                    showHardwareCounters={showHardwareCounters}
                />
            </TestProviders>,
        );

    it('hides the group by default, even on a report that has it', () => {
        renderTable([counted, uncounted]);

        expect(hardwareCounterHeaders()).toEqual([]);
    });

    it('shows the columns the report has once asked, and blanks a missing value', () => {
        renderTable([counted, uncounted], true);

        expect(hardwareCounterHeaders()).toEqual(['HW FPU', 'HW SFPU', 'HW MATH', 'HW FPU Full Grid']);

        expect(columnCells('HW FPU')).toEqual(['9.4%', '']);
        expect(columnCells('HW SFPU')).toEqual(['0%', '']);
        expect(columnCells('HW FPU Full Grid')).toEqual(['6%', '']);
    });

    it('blanks a comparison row whose report has no counters rather than writing NaN', () => {
        renderTable([counted], true, [plain]);

        expect(columnCells('HW FPU')).toEqual(['9.4%', '']);
        expect(screen.getByRole('table')).not.toHaveTextContent('NaN');
    });

    it('sorts a placeholder row without the counter last, either way', () => {
        // As `normalisePerformanceData` pads a report: a row with none of the counter keys.
        const placeholder = row(2, { op_code: 'MISSING', raw_op_code: 'MISSING' });
        renderTable(
            [row(1, { hw_fpu_util: 80 }), placeholder, row(3, { hw_fpu_util: 20 }), row(4, { hw_fpu_util: 40 })],
            true,
        );
        const sortByFpu = () => fireEvent.click(screen.getByRole('button', { name: 'HW FPU' }));

        sortByFpu();

        expect(columnCells('HW FPU')).toEqual(['20%', '40%', '80%', '']);

        sortByFpu();

        expect(columnCells('HW FPU')).toEqual(['80%', '40%', '20%', '']);
    });
});

describe('PerformanceReport hardware counters switch', () => {
    interface ReportOptions {
        comparisonData?: TypedPerfTableRow[][];
        comparisonReports?: string[];
        isStackedView?: boolean;
    }

    const renderReport = (
        data: TypedPerfTableRow[],
        hasHardwareCounters = true,
        { comparisonData = [], comparisonReports, isStackedView = false }: ReportOptions = {},
    ) => {
        const initialAtomValues: AtomProviderInitialValues = [[isStackedViewAtom, isStackedView]];

        if (comparisonReports) {
            initialAtomValues.push([comparisonPerformanceReportListAtom, comparisonReports]);
        }

        return render(
            <TestProviders initialAtomValues={initialAtomValues}>
                <PerformanceReport
                    data={data}
                    comparisonData={comparisonData}
                    stackedData={[]}
                    comparisonStackedData={[]}
                    maxCores={DEFAULT_MAX_CORES}
                    hasHardwareCounters={hasHardwareCounters}
                    hasLinkedOperations={false}
                />
            </TestProviders>,
        );
    };

    const counterSwitch = () => screen.getByTestId(TEST_IDS.PERF_HARDWARE_COUNTERS_SWITCH);

    const switchHint = async (hint: string) => {
        fireEvent.mouseEnter(screen.getByLabelText(SWITCH_LABEL));

        await waitFor(() => expect(screen.getByText(hint)).toBeInTheDocument());
    };

    it('is off by default, so the table shows no counter columns', () => {
        renderReport([counted]);

        expect(screen.getByLabelText(SWITCH_LABEL)).toHaveProperty('checked', false);
        expect(hardwareCounterHeaders()).toEqual([]);
    });

    it('adds the column group when switched on, and records the switch', () => {
        renderReport([counted]);

        fireEvent.click(screen.getByLabelText(SWITCH_LABEL));

        expect(hardwareCounterHeaders()).toEqual(['HW FPU', 'HW SFPU', 'HW MATH', 'HW FPU Full Grid']);
        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.PERF_TABLE_OPTION_TOGGLED,
            details: { perf_table_option: PerfTableOption.HARDWARE_COUNTERS },
        });
    });

    it('cannot be switched on for a report without counters, and names the flag that fills them', async () => {
        renderReport([plain], false);

        expect(screen.getByTestId(TEST_IDS.PERF_HARDWARE_COUNTERS_SWITCH)).toBeDisabled();
        await switchHint(NO_HARDWARE_COUNTERS_HINT);
    });

    it('cannot be switched on when the counters a report has are none of the columns, and says so', async () => {
        renderReport([plain], true);

        expect(screen.getByTestId(TEST_IDS.PERF_HARDWARE_COUNTERS_SWITCH)).toBeDisabled();
        await switchHint(NO_HARDWARE_COUNTER_COLUMNS_HINT);
    });

    it("reads the report's own flag rather than the rows' keys", () => {
        renderReport([counted], false);

        expect(screen.getByTestId(TEST_IDS.PERF_HARDWARE_COUNTERS_SWITCH)).toBeDisabled();
    });

    it('explains what it shows when it can be switched on', async () => {
        renderReport([counted]);

        await switchHint(HARDWARE_COUNTERS_SWITCH_HINT);
    });

    it('is not offered in the stacked view, whose table has no counter columns', () => {
        renderReport([counted], true, { isStackedView: true });

        expect(screen.queryByTestId(TEST_IDS.PERF_HARDWARE_COUNTERS_SWITCH)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Standard' }));

        expect(counterSwitch()).toBeEnabled();
    });

    it("can be switched on when only a comparison report's rows carry the columns", () => {
        renderReport([plain], true, { comparisonData: [[counted]] });

        expect(counterSwitch()).toBeEnabled();

        fireEvent.click(counterSwitch());

        expect(hardwareCounterHeaders()).toContain('HW FPU');
        expect(columnCells('HW FPU')).toEqual(['', '9.4%']);
        expect(screen.getByRole('table')).not.toHaveTextContent('NaN');
    });

    it("shows the columns on a comparison report's tab too, with that report's rows", () => {
        renderReport([counted], true, { comparisonData: [[busier]], comparisonReports: [COMPARISON_REPORT] });

        fireEvent.click(counterSwitch());
        fireEvent.click(screen.getByRole('tab', { name: COMPARISON_REPORT }));

        expect(screen.getByRole('tab', { name: COMPARISON_REPORT })).toHaveAttribute('aria-selected', 'true');
        expect(hardwareCounterHeaders()).toEqual(['HW FPU', 'HW SFPU', 'HW MATH', 'HW FPU Full Grid']);
        expect(columnCells('HW FPU')).toEqual(['50%', '9.4%']);
    });
});
