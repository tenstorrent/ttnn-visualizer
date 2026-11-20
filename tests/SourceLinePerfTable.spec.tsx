// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { Classes } from '@blueprintjs/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SourceLinePerfTable, { MAX_LISTED_OPERATIONS } from '../src/components/performance/SourceLinePerfTable';
import { PERF_FOOTER_ALL_DEVICES_NOTE } from '../src/components/performance/PerfFooterPercent';
import { StackSourceOrigin } from '../src/definitions/StackTrace';
import { TEST_IDS } from '../src/definitions/TestIds';
import {
    SOURCE_LINE_NO_TRACE_LABEL,
    SOURCE_LINE_UNLINKED_LABEL,
    SourceLineGroup,
    SourceLineGroupKind,
} from '../src/functions/perfSourceLines';
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
                totalDeviceTimeUs={10}
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

    it('sorts by a header and reverses on a second click, keeping every line', () => {
        renderTable({ groups: [GROUPS[0], GROUPS[1]] });
        const getLabels = () => getRows().map((row) => row.textContent?.match(/\w+\.py:\d+/)?.[0]);

        fireEvent.click(screen.getByRole('button', { name: 'Source line' }));
        expect(getLabels()).toEqual(['big.py:42', 'small.py:42']);

        fireEvent.click(screen.getByRole('button', { name: 'Source line' }));
        expect(getLabels()).toEqual(['small.py:42', 'big.py:42']);

        fireEvent.click(screen.getByRole('button', { name: 'Total %' }));
        expect(getLabels()).toEqual(['big.py:42', 'small.py:42']);
    });

    it('sorts line numbers as numbers, not as text', () => {
        const atLine = (lineNumber: number) =>
            group({ key: `line-${lineNumber}`, lineNumber, filePath: '/m/model.py', basename: 'model.py' });
        renderTable({ groups: [atLine(10), atLine(9), atLine(100)] });
        const getLabels = () => getRows().map((row) => row.textContent?.match(/\w+\.py:\d+/)?.[0]);

        fireEvent.click(screen.getByRole('button', { name: 'Source line' }));
        expect(getLabels()).toEqual(['model.py:9', 'model.py:10', 'model.py:100']);

        fireEvent.click(screen.getByRole('button', { name: 'Source line' }));
        expect(getLabels()).toEqual(['model.py:100', 'model.py:10', 'model.py:9']);
    });

    it('sorts the lines without a call site last, in either direction', () => {
        const atFile = (basename: string) =>
            group({ key: basename, basename, filePath: `/m/${basename}`, lineNumber: 3 });
        const withoutCallSite = (kind: SourceLineGroupKind) =>
            group({ key: kind, kind, basename: null, filePath: null, lineNumber: null, functionName: null });
        renderTable({
            groups: [
                atFile('Zeta.py'),
                withoutCallSite(SourceLineGroupKind.NO_TRACE),
                atFile('Attention.py'),
                withoutCallSite(SourceLineGroupKind.UNLINKED),
            ],
        });
        const getLabels = () =>
            getRows().map(
                (row) =>
                    row.textContent?.match(
                        new RegExp(`\\w+\\.py:\\d+|${SOURCE_LINE_NO_TRACE_LABEL}|${SOURCE_LINE_UNLINKED_LABEL}`),
                    )?.[0],
            );
        const withoutCallSiteLabels = [SOURCE_LINE_NO_TRACE_LABEL, SOURCE_LINE_UNLINKED_LABEL].sort();

        fireEvent.click(screen.getByRole('button', { name: 'Source line' }));
        expect(getLabels().slice(0, 2)).toEqual(['Attention.py:3', 'Zeta.py:3']);
        expect(getLabels().slice(2).sort()).toEqual(withoutCallSiteLabels);

        fireEvent.click(screen.getByRole('button', { name: 'Source line' }));
        expect(getLabels().slice(0, 2)).toEqual(['Zeta.py:3', 'Attention.py:3']);
        expect(getLabels().slice(2).sort()).toEqual(withoutCallSiteLabels);
    });

    it('orders two files sharing a basename and line by their full path', () => {
        const inDirectory = (directory: string) =>
            group({
                key: directory,
                basename: 'model.py',
                filePath: `/${directory}/model.py`,
                lineNumber: 3,
                functionName: `in_${directory}`,
            });
        renderTable({ groups: [inDirectory('b'), inDirectory('a')] });
        const getFunctions = () => getRows().map((row) => row.textContent?.match(/in_[ab]/)?.[0]);

        fireEvent.click(screen.getByRole('button', { name: 'Source line' }));
        expect(getFunctions()).toEqual(['in_a', 'in_b']);

        fireEvent.click(screen.getByRole('button', { name: 'Source line' }));
        expect(getFunctions()).toEqual(['in_b', 'in_a']);
    });

    it('orders two files sharing a basename by line number before full path', () => {
        const at = (directory: string, lineNumber: number) =>
            group({
                key: `${directory}-${lineNumber}`,
                basename: 'model.py',
                filePath: `/${directory}/model.py`,
                lineNumber,
            });
        renderTable({ groups: [at('a', 10), at('b', 8)] });
        const getLabels = () => getRows().map((row) => row.textContent?.match(/\w+\.py:\d+/)?.[0]);

        fireEvent.click(screen.getByRole('button', { name: 'Source line' }));
        expect(getLabels()).toEqual(['model.py:8', 'model.py:10']);
    });

    it('scrolls back to the top when a header re-sorts the lines', () => {
        renderTable();
        const scrollRegion = screen.getByRole('region', { name: 'Performance table' });
        scrollRegion.scrollTop = 200;

        fireEvent.click(screen.getByRole('button', { name: 'Source line' }));

        expect(scrollRegion.scrollTop).toBe(0);
    });

    it.each([
        ['every line', GROUPS, 10, '100%'],
        ['only the lines a filter leaves', [GROUPS[0]], 10, '20%'],
        ['lines with no countable time', [group({ percent: 0, deviceTimeUs: 0 })], 0, '0%'],
        [
            // Each line is all of its own device's time, so summing the rows' shares would say 200%.
            'one line on each of two unmerged devices',
            [
                group({ key: 'device-0', device: 0, deviceTimeUs: 5, percent: 100 }),
                group({ key: 'device-1', device: 1, deviceTimeUs: 5, percent: 100 }),
            ],
            10,
            '100%',
        ],
    ])('totals Total %% over %s', (_, groups, totalDeviceTimeUs, expected) => {
        renderTable({ groups, totalDeviceTimeUs });

        expect(document.querySelector('tfoot td')?.textContent).toBe(expected);
    });

    it('opens and closes a line, saying which it will do', () => {
        renderTable();

        const toggle = screen.getByRole('button', { name: 'Show operations for big.py:42' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(toggle);
        expect(screen.getByRole('button', { name: 'Hide operations for big.py:42' })).toHaveAttribute(
            'aria-expanded',
            'true',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Hide operations for big.py:42' }));
        expect(screen.queryByTestId(TEST_IDS.PERF_SOURCE_LINE_OPERATIONS)).toBeNull();
    });

    it('cannot expand a line with no operations', () => {
        renderTable({
            groups: [group({ key: 'unlinked', kind: SourceLineGroupKind.UNLINKED, filePath: null, operationIds: [] })],
        });

        expect(screen.getByRole('button', { name: 'Show operations for No linked operation' })).toBeDisabled();
    });

    it.each([
        [MAX_LISTED_OPERATIONS, MAX_LISTED_OPERATIONS, null],
        [MAX_LISTED_OPERATIONS + 1, MAX_LISTED_OPERATIONS, 'and 1 more'],
    ])('lists %i operations as %i links, then counts the rest', (operationCount, linkCount, moreText) => {
        const operationIds = Array.from({ length: operationCount }, (_, index) => index + 1);
        renderTable({ groups: [group({ operationIds })] });

        fireEvent.click(screen.getByRole('button', { name: 'Show operations for model.py:42' }));

        const operations = screen.getByTestId(TEST_IDS.PERF_SOURCE_LINE_OPERATIONS);
        expect(within(operations).getAllByRole('link')).toHaveLength(linkCount);

        if (moreText) {
            expect(within(operations).getByText(moreText)).toBeInTheDocument();
        } else {
            expect(within(operations).queryByText(/more$/)).toBeNull();
        }
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

    it('highlights a match even when the search ends in a space', () => {
        renderTable({ filterQuery: 'big ' });

        expect(screen.getByText('big', { selector: 'mark' })).toBeInTheDocument();
    });

    it('counts each source line once in the footer, not its per-device rows or the groups without one', () => {
        renderTable(
            {
                groups: [
                    group({ key: 'a0', device: 0 }),
                    group({ key: 'a1', device: 1 }),
                    group({ key: 'b0', lineNumber: 7, device: 0 }),
                    group({
                        key: 'unlinked',
                        kind: SourceLineGroupKind.UNLINKED,
                        filePath: null,
                        basename: null,
                        lineNumber: null,
                    }),
                ],
            },
            [[mergeDevicesAtom, false]],
        );

        expect(screen.getByText('2 source lines')).toBeInTheDocument();
    });

    it("marks Total % as a share of all devices' time only while devices are unmerged", async () => {
        renderTable({}, [[mergeDevicesAtom, true]]);
        expect(document.querySelector(`tfoot .${Classes.TOOLTIP_INDICATOR}`)).toBeNull();

        cleanup();

        renderTable({}, [[mergeDevicesAtom, false]]);
        const percent = document.querySelector(`tfoot .${Classes.TOOLTIP_INDICATOR}`) as HTMLElement;
        expect(percent).toHaveTextContent('100%');

        // Reachable from the keyboard: the tooltip makes its target focusable, which `fireEvent.focus` alone would not show.
        expect(percent).toHaveAttribute('tabindex', '0');
        fireEvent.focus(percent);
        expect(await screen.findByText(PERF_FOOTER_ALL_DEVICES_NOTE)).toBeInTheDocument();
    });

    it('says "1 source line" for one', () => {
        renderTable({ groups: [GROUPS[0]] });

        expect(screen.getByText('1 source line')).toBeInTheDocument();
    });

    it('adds a Device column only while devices are unmerged', () => {
        renderTable({}, [[mergeDevicesAtom, false]]);
        expect(screen.getByRole('button', { name: /^Device\b(?! Time)/ })).toBeInTheDocument();

        cleanup();

        renderTable({}, [[mergeDevicesAtom, true]]);
        expect(screen.queryByRole('button', { name: /^Device\b(?! Time)/ })).toBeNull();
    });
});
