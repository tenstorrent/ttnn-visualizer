// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourceLinePerfTable from '../src/components/performance/SourceLinePerfTable';
import { StackSourceOrigin } from '../src/definitions/StackTrace';
import { TEST_IDS } from '../src/definitions/TestIds';
import { SourceLineGroup, SourceLineGroupKind } from '../src/functions/perfSourceLines';
import { mergeDevicesAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import { AtomProviderInitialValues } from './helpers/atomProvider';

const isSourceFileAvailable = vi.fn();

vi.mock('../src/functions/recordEvent', () => ({ default: vi.fn() }));

vi.mock('../src/hooks/useRemote', () => ({
    default: () => ({
        readRemoteFile: vi.fn(),
        isSourceFileAvailable,
        persistentState: { selectedConnection: null },
    }),
}));

vi.mock('../src/hooks/useAPI.tsx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/hooks/useAPI.tsx')>();
    return {
        ...actual,
        usePerfMeta: () => ({ data: null, isLoading: false }),
    };
});

const group = (overrides: Partial<SourceLineGroup>): SourceLineGroup => ({
    key: 'line\u0000/m/model.py\u000042\u0000',
    kind: SourceLineGroupKind.LINE,
    filePath: '/m/model.py',
    basename: 'model.py',
    lineNumber: 42,
    functionName: 'forward',
    device: null,
    deviceTimeUs: 10,
    percent: 50,
    rowCount: 1,
    topOpCodes: ['Matmul'],
    operationIds: [7],
    sourceFileId: null,
    ...overrides,
});

const GROUPS = [
    group({ key: 'small', basename: 'small.py', filePath: '/m/small.py', deviceTimeUs: 2, percent: 20 }),
    group({
        key: 'big',
        basename: 'big.py',
        filePath: '/m/big.py',
        deviceTimeUs: 8,
        percent: 80,
        operationIds: [7, 8],
    }),
];

const OPERATION_BY_ID = new Map([
    [7, { name: 'ttnn.matmul' }],
    [8, { name: 'ttnn.softmax' }],
]);

const renderTable = (
    props: Partial<ComponentProps<typeof SourceLinePerfTable>> = {},
    initialAtomValues: AtomProviderInitialValues = [],
) =>
    render(
        <TestProviders initialAtomValues={initialAtomValues}>
            <SourceLinePerfTable
                groups={GROUPS}
                operationById={OPERATION_BY_ID}
                filterQuery=''
                reportFolderName={null}
                maxCores={64}
                {...props}
            />
        </TestProviders>,
    );

const getRows = () => screen.getAllByTestId(TEST_IDS.PERF_SOURCE_LINE_ROW);

afterEach(cleanup);

beforeEach(() => {
    isSourceFileAvailable.mockReset();
    isSourceFileAvailable.mockResolvedValue({ available: true, source: StackSourceOrigin.Path });
});

describe('SourceLinePerfTable', () => {
    it('keeps the order it is given, which is by device time', () => {
        renderTable({ groups: [GROUPS[1], GROUPS[0]] });

        expect(getRows().map((row) => row.textContent)).toEqual([
            expect.stringContaining('big.py:42'),
            expect.stringContaining('small.py:42'),
        ]);
    });

    it('expands a line to links to its operations', () => {
        renderTable();

        fireEvent.click(screen.getByRole('button', { name: 'Show operations for big.py:42' }));

        const operations = screen.getByTestId(TEST_IDS.PERF_SOURCE_LINE_OPERATIONS);
        expect(within(operations).getByRole('link', { name: '7 ttnn.matmul' })).toHaveAttribute(
            'href',
            '/operations/7',
        );
        expect(within(operations).getByRole('link', { name: '8 ttnn.softmax' })).toHaveAttribute(
            'href',
            '/operations/8',
        );
    });

    it('probes no source file until a Source button is hovered', async () => {
        renderTable();

        expect(isSourceFileAvailable).not.toHaveBeenCalled();

        fireEvent.mouseEnter(screen.getByRole('button', { name: 'View source for big.py:42' }));

        await waitFor(() => expect(isSourceFileAvailable).toHaveBeenCalledTimes(1));
    });

    it('gives the groups without a call site no Source button', () => {
        renderTable({ groups: [group({ key: 'unlinked', kind: SourceLineGroupKind.UNLINKED, filePath: null })] });

        expect(screen.queryByRole('button', { name: /View source/ })).toBeNull();
        expect(getRows()[0]).toHaveTextContent('No linked operation');
    });

    it('shows a skeleton while loading', () => {
        renderTable({ isLoading: true });

        expect(screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON)).toBeInTheDocument();
    });

    it('explains why it is empty when given a reason', () => {
        renderTable({ groups: [], emptyReason: 'Needs a linked memory report' });

        expect(screen.getByText('Needs a linked memory report')).toBeInTheDocument();
    });

    it('adds a Device column only while devices are unmerged', () => {
        renderTable({}, [[mergeDevicesAtom, false]]);
        expect(screen.getByRole('button', { name: /^Device\b(?! Time)/ })).toBeInTheDocument();

        cleanup();

        renderTable({}, [[mergeDevicesAtom, true]]);
        expect(screen.queryByRole('button', { name: /^Device\b(?! Time)/ })).toBeNull();
    });
});
