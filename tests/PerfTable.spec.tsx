// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PerfTable from '../src/components/performance/PerfTable';
import { TypedPerfTableRow, signpostRowDefaults } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { TEST_IDS } from '../src/definitions/TestIds';
import { useGetNPEManifest, useOpToPerfIdFiltered, useOperationsList, usePerfMeta } from '../src/hooks/useAPI';
import { selectedPerfRowIdAtom } from '../src/store/app';
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

function renderTable(rows: TypedPerfTableRow[]) {
    return render(
        <TestProviders>
            <PerfTable
                data={rows}
                comparisonData={[]}
                filters={null}
                provideMatmulAdvice={false}
                hiliteHighDispatch={false}
                reportName='unit-test'
                showHashColumn={false}
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
});
