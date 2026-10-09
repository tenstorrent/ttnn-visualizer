// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PerformanceReport from '../src/components/performance/PerfReport';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { PERF_DURATION_BUCKET_FILTER_PLACEHOLDER } from '../src/definitions/PerfDurationHistogram';
import { OpType } from '../src/definitions/Performance';
import { OperationCategories } from '../src/definitions/StackedPerfTable';
import { MathFidelity } from '../src/definitions/MathFidelity';
import { DeviceOperationLayoutTypes } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { TEST_IDS } from '../src/definitions/TestIds';
import { useGetNPEManifest, useOpToPerfIdFiltered, useOperationsList, usePerfMeta } from '../src/hooks/useAPI';
import {
    bufferTypeFilterListAtom,
    comparisonPerformanceReportListAtom,
    durationBucketFilterListAtom,
    layoutFilterListAtom,
    mathFilterListAtom,
    opCategoryFilterListAtom,
    rawOpCodeFilterListAtom,
} from '../src/store/app';
import { formatDurationBucketRange } from '../src/functions/formatDurationBucketRange';
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { TestProviders } from './helpers/TestProviders';
import { DEFAULT_MAX_CORES } from '../src/functions/getCoreCount';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetNPEManifest: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
    useOperationsList: vi.fn(),
    usePerfMeta: vi.fn(),
}));

const COMPARISON_REPORT = 'report-b';
const SECOND_COMPARISON_REPORT = 'report-c';
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
    mathFilterList?: string[];
    bufferTypeFilterList?: BufferType[];
    layoutFilterList?: DeviceOperationLayoutTypes[];
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
    mathFilterList = [],
    bufferTypeFilterList = [],
    layoutFilterList = [],
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

    if (mathFilterList.length > 0) {
        initialAtomValues.push([mathFilterListAtom, mathFilterList]);
    }

    if (bufferTypeFilterList.length > 0) {
        initialAtomValues.push([bufferTypeFilterListAtom, bufferTypeFilterList]);
    }

    if (layoutFilterList.length > 0) {
        initialAtomValues.push([layoutFilterListAtom, layoutFilterList]);
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

// Text highlighting splits a matching cell, so read whole rows rather than querying by text. The
// match is a substring: 'Reshape' also finds a 'ReshapeView' row.
const getRowsContaining = (text: string) =>
    Array.from(screen.getByRole('table').querySelectorAll('tbody tr')).filter((tableRow) =>
        tableRow.textContent?.includes(text),
    );

// The primary row and its comparison sub-row both survive: the filter must not empty either table.
function expectRowInBothReports(text: string) {
    const tableRows = getRowsContaining(text);

    expect(tableRows.some((tableRow) => tableRow.classList.contains('comparison-row'))).toBe(true);
    expect(tableRows.some((tableRow) => !tableRow.classList.contains('comparison-row'))).toBe(true);
}

// Normalisation is on by default; switching it off needs a comparison report to enable the toggle.
function setNormalisation(isOn: boolean) {
    if (!isOn) {
        fireEvent.click(screen.getByLabelText('Normalise data'));
    }

    expect(screen.getByLabelText('Normalise data')).toHaveProperty('checked', isOn);
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

describe('PerformanceReport filters resolved on aligned rows', () => {
    // Four rows per report so a normalised comparison stays within alignByOpCode's missing limit.
    const withOpCode = (base: TypedPerfTableRow, opCode: string) => ({ ...base, op_code: opCode });

    it.each([true, false])(
        'keeps a row whose op code text only the comparison report matches (normalised: %s)',
        (isNormalised) => {
            renderReport({
                data: [
                    row('Softmax', 1, 5),
                    withOpCode(row('Matmul', 2, 5), 'Matmul 64x64'),
                    row('Reshape', 3, 5),
                    row('Tilize', 4, 5),
                ],
                comparisonData: [
                    [
                        row('Softmax', 11, 5),
                        withOpCode(row('Matmul', 12, 5), 'Matmul 128x128'),
                        row('Reshape', 13, 5),
                        row('Tilize', 14, 5),
                    ],
                ],
                comparisonReports: [COMPARISON_REPORT],
            });

            setNormalisation(isNormalised);
            fireEvent.change(screen.getByPlaceholderText('Filter by operation name'), {
                target: { value: '128x128' },
            });

            expectRowInBothReports('Matmul');
            expect(getRowsContaining('Softmax')).toHaveLength(0);
            expect(getRowsContaining('Reshape')).toHaveLength(0);
            expect(getRowsContaining('Tilize')).toHaveLength(0);
        },
    );

    it.each([true, false])(
        'needs one aligned row to match every active filter, not each filter on some row (normalised: %s)',
        (isNormalised) => {
            renderReport({
                data: [
                    row('Softmax', 1, 5, OperationCategories.COMPUTE),
                    row('Matmul', 2, 5, OperationCategories.COMPUTE),
                    row('Reshape', 3, 5, OperationCategories.TM),
                    row('Tilize', 4, 5, OperationCategories.DM),
                ],
                comparisonData: [
                    [
                        row('Softmax', 11, 5, OperationCategories.COMPUTE),
                        row('Matmul', 12, 5, OperationCategories.COMPUTE),
                        // Other, but slow: no single Reshape row is both Other and in the 1-10 µs bucket.
                        row('Reshape', 13, 500, OperationCategories.OTHER),
                        // Other and fast, so the table still renders a matching row.
                        row('Tilize', 14, 5, OperationCategories.OTHER),
                    ],
                ],
                comparisonReports: [COMPARISON_REPORT],
                opCategoryFilterList: [OperationCategories.OTHER],
                durationBucketFilterList: [1],
            });

            setNormalisation(isNormalised);

            expectRowInBothReports('Tilize');
            expect(getRowsContaining('Reshape')).toHaveLength(0);
        },
    );

    it.each([true, false])(
        'needs one aligned row to match a set filter and another filter together (normalised: %s)',
        (isNormalised) => {
            const withLayout = (base: TypedPerfTableRow, layout: DeviceOperationLayoutTypes) => ({ ...base, layout });

            renderReport({
                data: [
                    withLayout(row('Softmax', 1, 5, OperationCategories.COMPUTE), DeviceOperationLayoutTypes.TILE),
                    withLayout(row('Matmul', 2, 5, OperationCategories.COMPUTE), DeviceOperationLayoutTypes.TILE),
                    // Row major, but Compute: only the comparison Reshape is Other.
                    withLayout(row('Reshape', 3, 5, OperationCategories.COMPUTE), DeviceOperationLayoutTypes.ROW_MAJOR),
                    withLayout(row('Tilize', 4, 5, OperationCategories.DM), DeviceOperationLayoutTypes.ROW_MAJOR),
                ],
                comparisonData: [
                    [
                        withLayout(row('Softmax', 11, 5, OperationCategories.COMPUTE), DeviceOperationLayoutTypes.TILE),
                        withLayout(row('Matmul', 12, 5, OperationCategories.COMPUTE), DeviceOperationLayoutTypes.TILE),
                        withLayout(row('Reshape', 13, 5, OperationCategories.OTHER), DeviceOperationLayoutTypes.TILE),
                        // Row major and Other, so the table still renders a matching row. The primary
                        // Tilize is row major too, so only the Reshape assertion depends on one row
                        // matching both filters.
                        withLayout(
                            row('Tilize', 14, 5, OperationCategories.OTHER),
                            DeviceOperationLayoutTypes.ROW_MAJOR,
                        ),
                    ],
                ],
                comparisonReports: [COMPARISON_REPORT],
                opCategoryFilterList: [OperationCategories.OTHER],
                layoutFilterList: [DeviceOperationLayoutTypes.ROW_MAJOR],
            });

            setNormalisation(isNormalised);

            expectRowInBothReports('Tilize');
            expect(getRowsContaining('Reshape')).toHaveLength(0);
        },
    );

    // Normalisation aligns rows by raw op code, so only the unnormalised view can pair rows whose
    // raw op codes differ.
    it('keeps a row whose raw op code only the comparison report has, with normalisation off', async () => {
        renderReport({
            data: [row('Softmax', 1, 5), row('Matmul', 2, 5), row('Reshape', 3, 5), row('Tilize', 4, 5)],
            comparisonData: [
                [row('Softmax', 11, 5), row('Matmul', 12, 5), row('ReshapeView', 13, 5), row('Tilize', 14, 5)],
            ],
            comparisonReports: [COMPARISON_REPORT],
        });

        // Normalised, the unmatched ReshapeView row becomes a placeholder and is not offered, so
        // switch off first and pick it from the select.
        setNormalisation(false);
        fireEvent.click(screen.getByPlaceholderText('Select Op Codes...'));
        // Wait for the option itself: the popover's portal can mount before its items do.
        fireEvent.click(await screen.findByRole('checkbox', { name: 'ReshapeView' }, WAIT_FOR_OPTIONS));

        // The substring match finds the comparison's ReshapeView row as well.
        expectRowInBothReports('Reshape');
        expect(getRowsContaining('Matmul')).toHaveLength(0);
    });
});

describe('PerformanceReport set filters resolved on aligned rows', () => {
    // 'match' is the filtered value, 'other' a value the filter excludes, and 'none' how a row with
    // no value arrives. DRAM is the filtered value because BufferType.DRAM is 0: a truthiness check
    // in the matcher would drop it.
    type Variant = 'match' | 'other' | 'none';

    const cases = [
        {
            name: 'math fidelity',
            withValue: (base: TypedPerfTableRow, variant: Variant) => ({
                ...base,
                // The parser leaves math fidelity as an empty string rather than null.
                math_fidelity: { match: MathFidelity.LoFi, other: MathFidelity.HiFi4, none: '' }[variant],
            }),
            filters: { mathFilterList: [MathFidelity.LoFi] },
        },
        {
            name: 'buffer type',
            withValue: (base: TypedPerfTableRow, variant: Variant) => ({
                ...base,
                buffer_type: { match: BufferType.DRAM, other: BufferType.L1, none: null }[variant],
            }),
            filters: { bufferTypeFilterList: [BufferType.DRAM] },
        },
        {
            name: 'layout',
            withValue: (base: TypedPerfTableRow, variant: Variant) => ({
                ...base,
                layout: {
                    match: DeviceOperationLayoutTypes.ROW_MAJOR,
                    other: DeviceOperationLayoutTypes.TILE,
                    none: null,
                }[variant],
            }),
            filters: { layoutFilterList: [DeviceOperationLayoutTypes.ROW_MAJOR] },
        },
    ];

    describe.each(cases)('$name', ({ withValue, filters }) => {
        // Only the comparison's Reshape holds the filtered value, so filtering the primary report
        // by itself would empty both tables.
        it.each([true, false])('keeps a comparison-only match (normalised: %s)', (isNormalised) => {
            renderReport({
                data: [withValue(row('Matmul', 1, 5), 'other'), withValue(row('Reshape', 2, 5), 'other')],
                comparisonData: [[withValue(row('Matmul', 1, 5), 'other'), withValue(row('Reshape', 2, 5), 'match')]],
                comparisonReports: [COMPARISON_REPORT],
                ...filters,
            });

            setNormalisation(isNormalised);

            expectRowInBothReports('Reshape');
            expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
        });

        it.each([true, false])(
            'keeps a primary row with no value when its comparison row matches (normalised: %s)',
            (isNormalised) => {
                renderReport({
                    data: [withValue(row('Matmul', 1, 5), 'other'), withValue(row('Reshape', 2, 5), 'none')],
                    comparisonData: [
                        [withValue(row('Matmul', 1, 5), 'other'), withValue(row('Reshape', 2, 5), 'match')],
                    ],
                    comparisonReports: [COMPARISON_REPORT],
                    ...filters,
                });

                setNormalisation(isNormalised);

                expectRowInBothReports('Reshape');
                expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
            },
        );

        // Only the primary report's Reshape holds the filtered value. The comparison-only cases
        // above never exercise a match on the primary row itself.
        it.each([true, false])('keeps a primary-only match (normalised: %s)', (isNormalised) => {
            renderReport({
                data: [withValue(row('Matmul', 1, 5), 'other'), withValue(row('Reshape', 2, 5), 'match')],
                comparisonData: [[withValue(row('Matmul', 1, 5), 'other'), withValue(row('Reshape', 2, 5), 'other')]],
                comparisonReports: [COMPARISON_REPORT],
                ...filters,
            });

            setNormalisation(isNormalised);

            expectRowInBothReports('Reshape');
            expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
        });

        // With no comparison report, normalisation switches off, so this filters one dataset in the
        // unnormalised branch.
        it('filters a single report', () => {
            renderReport({
                data: [
                    withValue(row('Matmul', 1, 5), 'other'),
                    withValue(row('Reshape', 2, 5), 'match'),
                    withValue(row('Softmax', 3, 5), 'none'),
                ],
                ...filters,
            });

            expect(getRowsContaining('Reshape').length).toBeGreaterThan(0);
            expect(getRowsContaining('Matmul')).toHaveLength(0);
            // A row with no value never matches an active filter.
            expect(getRowsContaining('Softmax')).toHaveLength(0);
        });

        // Both comparison loops cover every report, not just the first.
        it.each([true, false])(
            'keeps a match only the second comparison report has (normalised: %s)',
            (isNormalised) => {
                renderReport({
                    data: [withValue(row('Matmul', 1, 5), 'other'), withValue(row('Reshape', 2, 5), 'other')],
                    comparisonData: [
                        [withValue(row('Matmul', 1, 5), 'other'), withValue(row('Reshape', 2, 5), 'other')],
                        [withValue(row('Matmul', 1, 5), 'other'), withValue(row('Reshape', 2, 5), 'match')],
                    ],
                    comparisonReports: [COMPARISON_REPORT, SECOND_COMPARISON_REPORT],
                    ...filters,
                });

                setNormalisation(isNormalised);

                expectRowInBothReports('Reshape');
                expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
            },
        );
    });
});

describe('PerformanceReport set filter with several values selected', () => {
    it('keeps rows matching any selected value', () => {
        renderReport({
            data: [
                { ...row('Matmul', 1, 5), layout: DeviceOperationLayoutTypes.TILE },
                { ...row('Reshape', 2, 5), layout: DeviceOperationLayoutTypes.ROW_MAJOR },
                { ...row('Softmax', 3, 5), layout: null },
            ],
            layoutFilterList: [DeviceOperationLayoutTypes.TILE, DeviceOperationLayoutTypes.ROW_MAJOR],
        });

        expect(getRowsContaining('Matmul').length).toBeGreaterThan(0);
        expect(getRowsContaining('Reshape').length).toBeGreaterThan(0);
        expect(getRowsContaining('Softmax')).toHaveLength(0);
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

    /** The options only exist while the MultiSelect popover is open, and render after its portal. */
    const openDeviceTimeSelect = async () => {
        fireEvent.click(screen.getByPlaceholderText(PERF_DURATION_BUCKET_FILTER_PLACEHOLDER));
        // The page's switches are checkboxes too, so wait for a bucket option specifically.
        await screen.findAllByRole('checkbox', { name: /µs/ }, WAIT_FOR_OPTIONS);
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

describe('PerformanceReport high dispatch banner', () => {
    const withGap = (tableRow: TypedPerfTableRow, opToOpGap: number) =>
        ({ ...tableRow, op_to_op_gap: opToOpGap, high_dispatch: true }) as TypedPerfTableRow;

    // Regression: the banner summarised the original report on every tab, so a comparison tab's
    // Slow icons and its "could save" figure came from different reports.
    it("summarises the active tab's report", () => {
        renderReport({
            data: [withGap(row('Matmul', 1, 2), 16.5)],
            comparisonData: [[withGap(row('Matmul', 1, 2), 26.5)]],
            comparisonReports: [COMPARISON_REPORT],
        });

        fireEvent.click(screen.getByLabelText('Highlight high dispatch ops'));

        // Each saving is the gap minus the 6.5 µs threshold.
        expect(screen.getByText(/could save 10 µs/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: COMPARISON_REPORT }));

        expect(screen.getByText(/could save 20 µs/)).toBeInTheDocument();
        expect(screen.queryByText(/could save 10 µs/)).not.toBeInTheDocument();
    });
});
