// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PerformanceReport from '../src/components/performance/PerfReport';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { PERF_DURATION_BUCKET_FILTER_PLACEHOLDER } from '../src/definitions/PerfDurationHistogram';
import { OpType } from '../src/definitions/Performance';
import { OperationCategories } from '../src/definitions/StackedPerfTable';
import { TEST_IDS } from '../src/definitions/TestIds';
import { useGetNPEManifest, useOpToPerfIdFiltered, useOperationsList, usePerfMeta } from '../src/hooks/useAPI';
import {
    comparisonPerformanceReportListAtom,
    durationBucketFilterListAtom,
    opCategoryFilterListAtom,
    rawOpCodeFilterListAtom,
} from '../src/store/app';
import { formatDurationBucketRange } from '../src/functions/formatDurationBucketRange';
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { TestProviders } from './helpers/TestProviders';
import testForPortal from './helpers/testForPortal';
import { DEFAULT_MAX_CORES } from '../src/functions/getCoreCount';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetNPEManifest: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
    useOperationsList: vi.fn(),
    usePerfMeta: vi.fn(),
}));

const COMPARISON_REPORT = 'report-b';
/** Accessible name Blueprint gives a MultiSelect tag's dismiss button. */
const REMOVE_TAG_LABEL = 'Remove tag';
const WAIT_FOR_OPTIONS = { timeout: 1000 };

const row = (
    opCode: string,
    id = 1,
    deviceTime: number | null = null,
    opCategory: OperationCategories | null = null,
): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: opCode,
        raw_op_code: opCode,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        device_time: deviceTime,
        op_category: opCategory,
        id,
    }) as unknown as TypedPerfTableRow;

interface RenderOptions {
    isLoading?: boolean;
    isComparisonLoading?: boolean;
    comparisonData?: TypedPerfTableRow[][];
    comparisonReports?: string[] | null;
    data?: TypedPerfTableRow[];
    rawOpCodeFilterList?: string[];
    durationBucketFilterList?: number[];
    opCategoryFilterList?: OperationCategories[];
}

function renderReport({
    isLoading = false,
    isComparisonLoading = false,
    comparisonData = [],
    comparisonReports = null,
    data = [row('Matmul')],
    rawOpCodeFilterList = [],
    durationBucketFilterList = [],
    opCategoryFilterList = [],
}: RenderOptions = {}) {
    const initialAtomValues: AtomProviderInitialValues = [];

    if (comparisonReports) {
        initialAtomValues.push([comparisonPerformanceReportListAtom, comparisonReports]);
    }

    if (rawOpCodeFilterList.length > 0) {
        initialAtomValues.push([rawOpCodeFilterListAtom, rawOpCodeFilterList]);
    }

    if (durationBucketFilterList.length > 0) {
        initialAtomValues.push([durationBucketFilterListAtom, durationBucketFilterList]);
    }

    if (opCategoryFilterList.length > 0) {
        initialAtomValues.push([opCategoryFilterListAtom, opCategoryFilterList]);
    }

    return render(
        <TestProviders initialAtomValues={initialAtomValues}>
            <PerformanceReport
                data={data}
                comparisonData={comparisonData}
                stackedData={[]}
                comparisonStackedData={[]}
                isLoading={isLoading}
                isComparisonLoading={isComparisonLoading}
                maxCores={DEFAULT_MAX_CORES}
            />
        </TestProviders>,
    );
}

afterEach(cleanup);

// The primary row and its comparison sub-row both survive: the filter must not empty either table.
function expectRowInBothReports(opCode: string) {
    const tableRows = screen.getAllByText(opCode).map((cell) => cell.closest('tr'));

    expect(tableRows.some((tableRow) => tableRow?.classList.contains('comparison-row'))).toBe(true);
    expect(tableRows.some((tableRow) => tableRow && !tableRow.classList.contains('comparison-row'))).toBe(true);
}

beforeEach(() => {
    (useGetNPEManifest as Mock).mockReturnValue({ data: [], error: null });
    (useOpToPerfIdFiltered as Mock).mockReturnValue([]);
    (useOperationsList as Mock).mockReturnValue({ data: [] });
    (usePerfMeta as Mock).mockReturnValue({ data: null, isLoading: false });
});

describe('PerformanceReport loading state', () => {
    it('skeletons the active tab while a comparison dataset loads, even though active rows are present', () => {
        renderReport({ isComparisonLoading: true });

        expect(screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON)).toBeInTheDocument();
        // The already-loaded active rows are hidden behind the skeleton rather than popping in alongside
        // the incoming comparison sub-rows.
        expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
    });

    it('renders active rows without a skeleton once both datasets are loaded', () => {
        renderReport();

        expect(screen.queryByTestId(TEST_IDS.PERF_TABLE_SKELETON)).toBeNull();
        expect(screen.getAllByText('Matmul').length).toBeGreaterThan(0);
    });

    it('skeletons a comparison tab while its dataset loads instead of flashing the empty state', () => {
        renderReport({
            isComparisonLoading: true,
            comparisonData: [[row('Matmul')]],
            comparisonReports: [COMPARISON_REPORT],
        });

        fireEvent.click(screen.getByRole('tab', { name: COMPARISON_REPORT }));

        expect(screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON)).toBeInTheDocument();
        expect(screen.queryByText('No data to display')).not.toBeInTheDocument();
    });
});

describe('PerformanceReport raw op code filter', () => {
    it('shows only rows matching the hydrated raw op code filter atom', () => {
        renderReport({
            data: [row('Matmul', 1), row('Conv2d', 2)],
            rawOpCodeFilterList: ['Matmul'],
        });

        expect(screen.getAllByText('Matmul').length).toBeGreaterThan(0);
        expect(screen.queryByText('Conv2d')).not.toBeInTheDocument();
    });
});

describe('PerformanceReport op category filter', () => {
    it('shows only rows in a selected op category', () => {
        renderReport({
            data: [row('AllGather', 1, 5, OperationCategories.CCL), row('Matmul', 2, 5, OperationCategories.COMPUTE)],
            opCategoryFilterList: [OperationCategories.CCL],
        });

        expect(screen.getAllByText('AllGather').length).toBeGreaterThan(0);
        expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
    });

    it('prunes a selected category that the data does not contain instead of emptying the table', () => {
        renderReport({
            data: [row('Matmul', 1, 5, OperationCategories.COMPUTE)],
            opCategoryFilterList: [OperationCategories.CCL],
        });

        expect(screen.getAllByText('Matmul').length).toBeGreaterThan(0);
    });

    it('shares out only the filtered rows in the category breakdown', () => {
        renderReport({
            data: [row('AllGather', 1, 30, OperationCategories.CCL), row('Matmul', 2, 70, OperationCategories.COMPUTE)],
            opCategoryFilterList: [OperationCategories.CCL],
        });

        const breakdown = screen.getByTestId(TEST_IDS.PERF_OP_CATEGORY_BREAKDOWN);

        expect(breakdown).toHaveTextContent('CCL 100%');
        expect(breakdown).toHaveTextContent('Compute 0%');
    });

    it('keeps a comparison-only match with normalisation on', () => {
        renderReport({
            data: [row('Matmul', 1, 5, OperationCategories.COMPUTE), row('Reshape', 2, 5, OperationCategories.TM)],
            comparisonData: [
                [row('Matmul', 1, 5, OperationCategories.COMPUTE), row('Reshape', 2, 5, OperationCategories.OTHER)],
            ],
            comparisonReports: [COMPARISON_REPORT],
            opCategoryFilterList: [OperationCategories.OTHER],
        });

        expect(screen.getByLabelText('Normalise data')).toBeChecked();
        expectRowInBothReports('Reshape');
        expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
    });

    it('keeps a comparison-only match with normalisation turned off', () => {
        renderReport({
            data: [row('Matmul', 1, 5, OperationCategories.COMPUTE), row('Reshape', 2, 5, OperationCategories.TM)],
            comparisonData: [
                [row('Matmul', 1, 5, OperationCategories.COMPUTE), row('Reshape', 2, 5, OperationCategories.OTHER)],
            ],
            comparisonReports: [COMPARISON_REPORT],
            opCategoryFilterList: [OperationCategories.OTHER],
        });

        fireEvent.click(screen.getByLabelText('Normalise data'));

        expectRowInBothReports('Reshape');
        expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
    });
});

describe('PerformanceReport sorting with a normalised comparison', () => {
    // Four rows so one missing op stays under alignByOpCode's 30% missing limit.
    const OP_CODES = ['MISSING - AllGather', 'AllGather', 'Matmul', 'Reshape', 'Softmax'];
    const getTableRowLabels = () =>
        Array.from(screen.getByRole('table').querySelectorAll('tbody tr')).map((tableRow) => {
            const opCode = OP_CODES.find((code) => tableRow.textContent?.includes(code)) ?? '';

            return tableRow.classList.contains('comparison-row') ? `sub:${opCode}` : opCode;
        });

    it('keeps the missing-op placeholder under its primary row when sorting by category', () => {
        renderReport({
            data: [
                row('Matmul', 1, 5, OperationCategories.COMPUTE),
                row('AllGather', 2, 5, OperationCategories.CCL),
                row('Reshape', 3, 5, OperationCategories.TM),
                row('Softmax', 4, 5, OperationCategories.COMPUTE),
            ],
            comparisonData: [
                [
                    row('Matmul', 11, 5, OperationCategories.COMPUTE),
                    row('Reshape', 13, 5, OperationCategories.TM),
                    row('Softmax', 14, 5, OperationCategories.COMPUTE),
                ],
            ],
            comparisonReports: [COMPARISON_REPORT],
        });

        expect(screen.getByLabelText('Normalise data')).toBeChecked();

        fireEvent.click(screen.getByRole('button', { name: /^Category/ }));

        expect(getTableRowLabels()).toEqual([
            'AllGather',
            'sub:MISSING - AllGather',
            'Matmul',
            'sub:Matmul',
            'Softmax',
            'sub:Softmax',
            'Reshape',
            'sub:Reshape',
        ]);
    });
});

describe('PerformanceReport duration bucket filter', () => {
    it('shows only rows whose device time bins into a selected bucket', () => {
        renderReport({
            data: [row('Matmul', 1, 5), row('Conv2d', 2, 500)],
            durationBucketFilterList: [1],
        });

        expect(screen.getAllByText('Matmul').length).toBeGreaterThan(0);
        expect(screen.queryByText('Conv2d')).not.toBeInTheDocument();
    });

    it('unions several selected buckets', () => {
        renderReport({
            data: [row('Matmul', 1, 5), row('Conv2d', 2, 50), row('Reduce', 3, 500)],
            durationBucketFilterList: [1, 100],
        });

        expect(screen.getAllByText('Matmul').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Reduce').length).toBeGreaterThan(0);
        expect(screen.queryByText('Conv2d')).not.toBeInTheDocument();
    });

    it('drops rows with no device time while a bucket is selected', () => {
        renderReport({
            data: [row('Matmul', 1, 5), row('Conv2d', 2, null)],
            durationBucketFilterList: [1],
        });

        expect(screen.getAllByText('Matmul').length).toBeGreaterThan(0);
        expect(screen.queryByText('Conv2d')).not.toBeInTheDocument();
    });

    it('prunes a selected bucket that the data does not contain instead of emptying the table', () => {
        renderReport({
            data: [row('Matmul', 1, 5), row('Conv2d', 2, 8)],
            // 1000us has no rows, so no bucket spans it and the stale selection must be discarded
            durationBucketFilterList: [1000],
        });

        expect(screen.getAllByText('Matmul').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Conv2d').length).toBeGreaterThan(0);
    });

    it('keeps an index whose comparison row alone falls in the bucket', () => {
        renderReport({
            data: [row('Matmul', 1, 5), row('Conv2d', 2, 5)],
            comparisonData: [[row('Matmul', 1, 5), row('Conv2d', 2, 500)]],
            comparisonReports: [COMPARISON_REPORT],
            durationBucketFilterList: [100],
        });

        // Only the comparison report is slow here, which is the case worth surfacing
        expect(screen.getAllByText('Conv2d').length).toBeGreaterThan(0);
        expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
    });

    it('keeps a comparison-only match with normalisation turned off', () => {
        renderReport({
            data: [row('Matmul', 1, 5), row('Conv2d', 2, 5)],
            comparisonData: [[row('Matmul', 1, 5), row('Conv2d', 2, 500)]],
            comparisonReports: [COMPARISON_REPORT],
            durationBucketFilterList: [100],
        });

        fireEvent.click(screen.getByLabelText('Normalise data'));

        expect(screen.getAllByText('Conv2d').length).toBeGreaterThan(0);
        expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
    });

    it('keeps a comparison-only bucket selected when that comparison tab is opened', () => {
        renderReport({
            // No active-report row reaches 100us, so options built per dataset would prune the selection
            data: [row('Matmul', 1, 5), row('Conv2d', 2, 5)],
            comparisonData: [[row('Matmul', 1, 5), row('Conv2d', 2, 500)]],
            comparisonReports: [COMPARISON_REPORT],
            durationBucketFilterList: [100],
        });

        fireEvent.click(screen.getByRole('tab', { name: COMPARISON_REPORT }));

        expect(screen.getAllByText(formatDurationBucketRange(100, 1000)).length).toBeGreaterThan(0);
        expect(screen.getAllByText('Conv2d').length).toBeGreaterThan(0);
        expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
    });
});

describe('PerformanceReport duration bucket options', () => {
    // Decades run contiguously between the extremes, so 10-100us and 100-1000us are offered
    // without holding a single row
    const gappedRows = [row('Matmul', 1, 5), row('Conv2d', 2, 5000)];

    /** The options only exist while the MultiSelect popover is open. */
    const openDeviceTimeSelect = async () => {
        fireEvent.click(screen.getByPlaceholderText(PERF_DURATION_BUCKET_FILTER_PLACEHOLDER));
        await waitFor(testForPortal, WAIT_FOR_OPTIONS);
    };

    const getOption = (minUs: number, maxUs: number) =>
        screen.getByRole('checkbox', { name: formatDurationBucketRange(minUs, maxUs) });

    it('disables the buckets holding no rows and leaves the populated ones selectable', async () => {
        renderReport({ data: gappedRows });

        await openDeviceTimeSelect();

        expect(getOption(1, 10)).toBeEnabled();
        expect(getOption(10, 100)).toBeDisabled();
        expect(getOption(100, 1000)).toBeDisabled();
        expect(getOption(1000, 10000)).toBeEnabled();
    });

    it('does not filter on a click through a disabled bucket, which would empty the table', async () => {
        renderReport({ data: gappedRows });

        await openDeviceTimeSelect();
        fireEvent.click(getOption(10, 100));

        expect(getOption(10, 100)).not.toBeChecked();
        expect(screen.getAllByText('Matmul').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Conv2d').length).toBeGreaterThan(0);
    });

    it('counts a comparison report towards a bucket, since the filter spans every dataset', async () => {
        renderReport({
            data: gappedRows,
            comparisonData: [[row('Matmul', 1, 5), row('Conv2d', 2, 50)]],
            comparisonReports: [COMPARISON_REPORT],
        });

        await openDeviceTimeSelect();

        expect(getOption(10, 100)).toBeEnabled();
        expect(getOption(100, 1000)).toBeDisabled();
    });
});

describe('PerformanceReport duration bucket tag', () => {
    // Clicking a histogram column applies the filter without touching the select, so the tag is
    // the only thing telling the user what is filtered — and the only way back out of it.
    it('names the selected bucket by its readable range rather than the stored minimum', () => {
        renderReport({
            data: [row('Matmul', 1, 5), row('Conv2d', 2, 500)],
            durationBucketFilterList: [1],
        });

        expect(screen.getByText(formatDurationBucketRange(1, 10))).toBeInTheDocument();
        expect(screen.getByRole('button', { name: REMOVE_TAG_LABEL })).toBeInTheDocument();
    });

    it('restores the rows the filter hid when its tag is removed', () => {
        renderReport({
            data: [row('Matmul', 1, 5), row('Conv2d', 2, 500)],
            durationBucketFilterList: [1],
        });

        expect(screen.queryByText('Conv2d')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: REMOVE_TAG_LABEL }));

        expect(screen.getAllByText('Conv2d').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Matmul').length).toBeGreaterThan(0);
        expect(screen.queryByText(formatDurationBucketRange(1, 10))).not.toBeInTheDocument();
    });
});
