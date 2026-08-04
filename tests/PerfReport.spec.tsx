// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PerformanceReport from '../src/components/performance/PerfReport';
import { TypedPerfTableRow } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { TEST_IDS } from '../src/definitions/TestIds';
import { useGetNPEManifest, useOpToPerfIdFiltered, useOperationsList, usePerfMeta } from '../src/hooks/useAPI';
import {
    comparisonPerformanceReportListAtom,
    durationBucketFilterListAtom,
    rawOpCodeFilterListAtom,
} from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import { DEFAULT_MAX_CORES } from '../src/functions/getCoreCount';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetNPEManifest: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
    useOperationsList: vi.fn(),
    usePerfMeta: vi.fn(),
}));

const COMPARISON_REPORT = 'report-b';

const row = (opCode: string, id = 1, deviceTime: number | null = null): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: opCode,
        raw_op_code: opCode,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        device_time: deviceTime,
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
}

function renderReport({
    isLoading = false,
    isComparisonLoading = false,
    comparisonData = [],
    comparisonReports = null,
    data = [row('Matmul')],
    rawOpCodeFilterList = [],
    durationBucketFilterList = [],
}: RenderOptions = {}) {
    const initialAtomValues: [
        (
            | typeof comparisonPerformanceReportListAtom
            | typeof rawOpCodeFilterListAtom
            | typeof durationBucketFilterListAtom
        ),
        unknown,
    ][] = [];

    if (comparisonReports) {
        initialAtomValues.push([comparisonPerformanceReportListAtom, comparisonReports]);
    }

    if (rawOpCodeFilterList.length > 0) {
        initialAtomValues.push([rawOpCodeFilterListAtom, rawOpCodeFilterList]);
    }

    if (durationBucketFilterList.length > 0) {
        initialAtomValues.push([durationBucketFilterListAtom, durationBucketFilterList]);
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
});
