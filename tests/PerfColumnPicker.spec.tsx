// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import PerfTableToolbar from '../src/components/performance/PerfTableToolbar';
import { ColumnKeys, Columns } from '../src/definitions/PerfTable';
import { TEST_IDS } from '../src/definitions/TestIds';
import { hiddenPerfTableColumnsAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';

function HiddenColumnsProbe() {
    const hiddenColumns = useAtomValue(hiddenPerfTableColumnsAtom);

    return <span data-testid='hidden-columns-probe'>{hiddenColumns.join(',')}</span>;
}

afterEach(cleanup);

describe('PerfTableToolbar', () => {
    it('toggles a column into hiddenPerfTableColumnsAtom', () => {
        render(
            <TestProviders initialAtomValues={[[hiddenPerfTableColumnsAtom, []]]}>
                <PerfTableToolbar eligibleColumns={Columns} />
                <HiddenColumnsProbe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId(TEST_IDS.PERF_COLUMN_PICKER_TRIGGER));

        const picker = screen.getByTestId(TEST_IDS.PERF_COLUMN_PICKER);
        const deviceTimeCheckbox = within(picker).getByTestId(
            `${TEST_IDS.PERF_COLUMN_PICKER_OPTION}-${ColumnKeys.DeviceTime}`,
        );

        fireEvent.click(deviceTimeCheckbox);

        expect(screen.getByTestId('hidden-columns-probe')).toHaveTextContent(ColumnKeys.DeviceTime);
    });

    it('does not hide locked columns', () => {
        render(
            <TestProviders initialAtomValues={[[hiddenPerfTableColumnsAtom, []]]}>
                <PerfTableToolbar eligibleColumns={Columns} />
                <HiddenColumnsProbe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId(TEST_IDS.PERF_COLUMN_PICKER_TRIGGER));

        const picker = screen.getByTestId(TEST_IDS.PERF_COLUMN_PICKER);
        const opCodeCheckbox = within(picker).getByTestId(
            `${TEST_IDS.PERF_COLUMN_PICKER_OPTION}-${ColumnKeys.OpCode}`,
        ) as HTMLInputElement;

        expect(opCodeCheckbox).toBeDisabled();
        expect(opCodeCheckbox).toBeChecked();

        fireEvent.click(opCodeCheckbox);

        expect(screen.getByTestId('hidden-columns-probe')).toHaveTextContent('');
    });

    it('clears hidden columns when Show all is clicked', () => {
        render(
            <TestProviders initialAtomValues={[[hiddenPerfTableColumnsAtom, [ColumnKeys.DeviceTime, ColumnKeys.Dram]]]}>
                <PerfTableToolbar eligibleColumns={Columns} />
                <HiddenColumnsProbe />
            </TestProviders>,
        );

        fireEvent.click(screen.getByTestId(TEST_IDS.PERF_COLUMN_PICKER_TRIGGER));
        fireEvent.click(screen.getByTestId(TEST_IDS.PERF_COLUMN_PICKER_RESET));

        expect(screen.getByTestId('hidden-columns-probe')).toHaveTextContent('');
    });
});
