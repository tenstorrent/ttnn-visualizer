// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PerfTable from '../src/components/performance/PerfTable';
import { ColumnKeys, TypedPerfTableRow, signpostRowDefaults } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { TEST_IDS } from '../src/definitions/TestIds';
import { useGetNPEManifest, useOpToPerfIdFiltered, useOperationsList, usePerfMeta } from '../src/hooks/useAPI';
import { hiddenPerfTableColumnsAtom, selectedPerfRowIdAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetNPEManifest: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
    useOperationsList: vi.fn(),
    usePerfMeta: vi.fn(),
}));

const baseRow = (
    overrides: Partial<TypedPerfTableRow> & Pick<TypedPerfTableRow, 'id' | 'raw_op_code'>,
): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: overrides.raw_op_code,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        ...overrides,
    }) as unknown as TypedPerfTableRow;

const signpostRow = (id: number): TypedPerfTableRow =>
    ({
        ...signpostRowDefaults,
        id,
        op_code: '---SIGNPOST---',
        raw_op_code: '---SIGNPOST---',
    }) as unknown as TypedPerfTableRow;

const matmulRow = baseRow({ id: 1, raw_op_code: 'Matmul', op: 11 });
const missingRow = baseRow({ id: 2, raw_op_code: 'Reshape MISSING', op: undefined });
const unmappedRow = baseRow({ id: 3, raw_op_code: 'AddOp', op: undefined });
const signpost = signpostRow(4);

interface RenderTableOptions {
    comparisonData?: TypedPerfTableRow[][];
    activeReportComparisonIndex?: number | null;
    hiddenColumns?: ColumnKeys[];
}

function renderTable(rows: TypedPerfTableRow[], options: RenderTableOptions = {}) {
    const { comparisonData = [], activeReportComparisonIndex = null, hiddenColumns = [] } = options;

    return render(
        <TestProviders initialAtomValues={[[hiddenPerfTableColumnsAtom, hiddenColumns]]}>
            <PerfTable
                data={rows}
                comparisonData={comparisonData}
                filters={null}
                provideMatmulAdvice={false}
                hiliteHighDispatch={false}
                reportName='unit-test'
                showHashColumn={false}
                activeReportComparisonIndex={activeReportComparisonIndex}
            />
        </TestProviders>,
    );
}

afterEach(cleanup);

beforeEach(() => {
    (useGetNPEManifest as Mock).mockReturnValue({ data: [], error: null });
    (useOperationsList as Mock).mockReturnValue({ data: [] });
    (usePerfMeta as Mock).mockReturnValue({ data: null, isLoading: false });
});

describe('PerfTable tensor-drawer trigger column', () => {
    it('renders an enabled trigger button on synced data rows', () => {
        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ opId: 11, perfId: '1' }]);
        renderTable([matmulRow]);

        const triggers = screen.getAllByTestId(TEST_IDS.PERF_TENSOR_DRAWER_OPEN_BUTTON);
        expect(triggers).toHaveLength(1);
        expect(triggers[0]).toBeEnabled();
    });

    it('omits the trigger button entirely on signpost rows', () => {
        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ opId: 11, perfId: '1' }]);
        renderTable([matmulRow, signpost]);

        const signpostCell = screen.getByText('---SIGNPOST---').closest('tr')!;
        expect(within(signpostCell).queryByTestId(TEST_IDS.PERF_TENSOR_DRAWER_OPEN_BUTTON)).toBeNull();
    });

    it('disables the trigger button for rows with no linked profiler op', () => {
        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ opId: 11, perfId: '1' }]);
        renderTable([unmappedRow]);

        expect(screen.getByTestId(TEST_IDS.PERF_TENSOR_DRAWER_OPEN_BUTTON)).toBeDisabled();
    });

    it('disables the trigger button when reports are not synced', () => {
        (useOpToPerfIdFiltered as Mock).mockReturnValue([]);
        renderTable([matmulRow]);

        expect(screen.getByTestId(TEST_IDS.PERF_TENSOR_DRAWER_OPEN_BUTTON)).toBeDisabled();
    });

    it('marks the row as selected when the trigger is clicked', () => {
        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ opId: 11, perfId: '1' }]);
        renderTable([matmulRow]);

        const trigger = screen.getByTestId(TEST_IDS.PERF_TENSOR_DRAWER_OPEN_BUTTON);
        fireEvent.click(trigger);

        expect(trigger.closest('tr')).toHaveClass('is-selected');
    });

    it('renders the trigger on the comparison sub-row that holds the active report (comparison-report tab)', () => {
        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ opId: 11, perfId: '1' }]);

        // Comparison-report tab layout: primary `data` rows are the selected comparison
        // report, and `comparisonData[0]` rows are the active profiler report.
        const comparisonReportRow = baseRow({ id: 99, raw_op_code: 'Matmul', op: undefined });
        const activeReportSubRow = baseRow({ id: 11, raw_op_code: 'Matmul', op: 11 });

        renderTable([comparisonReportRow], {
            comparisonData: [[activeReportSubRow]],
            activeReportComparisonIndex: 0,
        });

        const triggers = screen.getAllByTestId(TEST_IDS.PERF_TENSOR_DRAWER_OPEN_BUTTON);
        expect(triggers).toHaveLength(1);

        const triggerRow = triggers[0].closest('tr')!;
        expect(triggerRow).toHaveClass('comparison-row');
        expect(triggers[0]).toBeEnabled();
    });

    it('highlights the row that matches the hydrated selectedPerfRowIdAtom', () => {
        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ opId: 11, perfId: '1' }]);

        render(
            <TestProviders initialAtomValues={[[selectedPerfRowIdAtom, matmulRow.id]]}>
                <PerfTable
                    data={[matmulRow, missingRow]}
                    comparisonData={[]}
                    filters={null}
                    provideMatmulAdvice={false}
                    hiliteHighDispatch={false}
                    reportName='unit-test'
                    showHashColumn={false}
                />
            </TestProviders>,
        );

        const matmulCell = screen.getByText('Matmul').closest('tr')!;
        const missingCell = screen.getByText(/Reshape MISSING/).closest('tr')!;

        expect(matmulCell).toHaveClass('is-selected');
        expect(missingCell).not.toHaveClass('is-selected');
    });

    // Regression guard for the clean-up effect inside `PerfTable` that resets
    // `selectedPerfRowIdAtom` whenever the table can no longer show the drawer
    // (no op-id sync, no active-report rows). Without this, a stale selection
    // from a previous render would silently re-open the drawer once sync returns.
    it('clears selectedPerfRowIdAtom when the reports become unsynced', () => {
        let opIdMapping: { opId: number; perfId: string }[] = [{ opId: 11, perfId: '1' }];
        (useOpToPerfIdFiltered as Mock).mockImplementation(() => opIdMapping);

        const { rerender } = render(
            <TestProviders initialAtomValues={[[selectedPerfRowIdAtom, matmulRow.id]]}>
                <PerfTable
                    data={[matmulRow]}
                    comparisonData={[]}
                    filters={null}
                    provideMatmulAdvice={false}
                    hiliteHighDispatch={false}
                    reportName='unit-test'
                    showHashColumn={false}
                />
                <SelectedRowProbe />
            </TestProviders>,
        );

        expect(screen.getByText('Matmul').closest('tr')).toHaveClass('is-selected');
        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent('1');
        expect(screen.getByTestId(TEST_IDS.PERF_TENSOR_DRAWER)).toBeInTheDocument();

        opIdMapping = [];
        rerender(
            <TestProviders initialAtomValues={[[selectedPerfRowIdAtom, matmulRow.id]]}>
                <PerfTable
                    data={[matmulRow]}
                    comparisonData={[]}
                    filters={null}
                    provideMatmulAdvice={false}
                    hiliteHighDispatch={false}
                    reportName='unit-test'
                    showHashColumn={false}
                />
                <SelectedRowProbe />
            </TestProviders>,
        );

        expect(screen.getByText('Matmul').closest('tr')).not.toHaveClass('is-selected');
        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent('null');
        expect(screen.queryByTestId(TEST_IDS.PERF_TENSOR_DRAWER)).not.toBeInTheDocument();
    });

    // Regression guard for the second clean-up branch: if filters or the range
    // slider drop the selected row from `activeReportRows` while other rows
    // remain (drawer still showable), the selection must be cleared so it can't
    // silently re-open later when the row reappears.
    it('clears selectedPerfRowIdAtom when the selected row is filtered out of activeReportRows', () => {
        (useOpToPerfIdFiltered as Mock).mockReturnValue([{ opId: 11, perfId: '1' }]);

        const otherRow = baseRow({ id: 7, raw_op_code: 'OtherOp', op: 12 });

        const { rerender } = render(
            <TestProviders initialAtomValues={[[selectedPerfRowIdAtom, matmulRow.id]]}>
                <PerfTable
                    data={[matmulRow, otherRow]}
                    comparisonData={[]}
                    filters={null}
                    provideMatmulAdvice={false}
                    hiliteHighDispatch={false}
                    reportName='unit-test'
                    showHashColumn={false}
                />
                <SelectedRowProbe />
            </TestProviders>,
        );

        expect(screen.getByText('Matmul').closest('tr')).toHaveClass('is-selected');
        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent('1');

        rerender(
            <TestProviders initialAtomValues={[[selectedPerfRowIdAtom, matmulRow.id]]}>
                <PerfTable
                    data={[otherRow]}
                    comparisonData={[]}
                    filters={null}
                    provideMatmulAdvice={false}
                    hiliteHighDispatch={false}
                    reportName='unit-test'
                    showHashColumn={false}
                />
                <SelectedRowProbe />
            </TestProviders>,
        );

        // Matmul cell renders inside the table body; the drawer header still
        // surfaces the row's op code from the previous selection until the
        // Drawer animates closed, so scope the lookup to the table.
        const tableBody = screen.getByRole('table').querySelector('tbody')!;
        expect(within(tableBody).queryByText('Matmul')).not.toBeInTheDocument();
        expect(screen.getByTestId('selected-row-probe')).toHaveTextContent('null');
    });
});

describe('PerfTable loading state', () => {
    beforeEach(() => {
        (useOpToPerfIdFiltered as Mock).mockReturnValue([]);
    });

    it('renders the skeleton instead of data rows while loading', () => {
        render(
            <TestProviders>
                <PerfTable
                    data={[matmulRow]}
                    comparisonData={[]}
                    filters={null}
                    provideMatmulAdvice={false}
                    hiliteHighDispatch={false}
                    reportName='unit-test'
                    showHashColumn={false}
                    isLoading
                />
            </TestProviders>,
        );

        const skeleton = screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON);
        expect(skeleton).toBeInTheDocument();
        expect(skeleton).toHaveAttribute('aria-busy', 'true');
        // No real data rows or footer totals leak through while loading
        expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
        expect(screen.queryByTestId(TEST_IDS.PERF_TENSOR_DRAWER_OPEN_BUTTON)).toBeNull();
    });

    it('keeps the device-architecture strip mounted while loading (scoped skeleton)', () => {
        render(
            <TestProviders>
                <PerfTable
                    data={[]}
                    comparisonData={[]}
                    filters={null}
                    provideMatmulAdvice={false}
                    hiliteHighDispatch={false}
                    reportName='unit-test'
                    showHashColumn={false}
                    isLoading
                />
            </TestProviders>,
        );

        expect(screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON)).toBeInTheDocument();
        expect(screen.getByText('Arch:')).toBeInTheDocument();
    });

    it('shows the empty state rather than the skeleton when not loading and there are no rows', () => {
        render(
            <TestProviders>
                <PerfTable
                    data={[]}
                    comparisonData={[]}
                    filters={null}
                    provideMatmulAdvice={false}
                    hiliteHighDispatch={false}
                    reportName='unit-test'
                    showHashColumn={false}
                />
            </TestProviders>,
        );

        expect(screen.queryByTestId(TEST_IDS.PERF_TABLE_SKELETON)).toBeNull();
        expect(screen.getByText('No data to display')).toBeInTheDocument();
    });
});

describe('PerfTable column visibility', () => {
    it('keeps OP Code visible even when it is listed as hidden', () => {
        renderTable([matmulRow], { hiddenColumns: [ColumnKeys.OpCode, ColumnKeys.DeviceTime] });

        const table = screen.getByRole('table');
        expect(within(table).getByText('OP Code')).toBeInTheDocument();
        expect(within(table).queryByText('Device Time')).not.toBeInTheDocument();
    });

    it('keeps footer cells aligned when Device and Type are hidden', () => {
        renderTable([matmulRow], { hiddenColumns: [ColumnKeys.Device, ColumnKeys.BufferType] });

        const footerCells = screen.getByRole('table').querySelectorAll('tfoot td');
        const visibleHeaderCount = screen.getByRole('table').querySelectorAll('thead th').length;
        const footerSpanTotal =
            Array.from(footerCells)
                .slice(1)
                .reduce((total, cell) => total + Number(cell.getAttribute('colspan') ?? 1), 0) ?? 0;

        expect(footerSpanTotal).toBe(visibleHeaderCount - 1);
    });
});

function SelectedRowProbe() {
    const selected = useAtomValue(selectedPerfRowIdAtom);

    return <span data-testid='selected-row-probe'>{selected === null ? 'null' : String(selected)}</span>;
}
