// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useMemo } from 'react';
import { DurationBucket } from '../../definitions/PerfDurationHistogram';
import { ColumnKeys, PerfTableFilters } from '../../definitions/PerfTable';
import { TypedPerfTableRow } from '../../model/PerfTable';
import { OpType } from '../../definitions/Performance';
import {
    buildLogDecadeBuckets,
    getEmptyBucketMinUs,
    isDurationInSelectedBuckets,
} from '../../functions/durationBuckets';
import alignByOpCode from '../../functions/normalisePerformanceData';
import { Signpost } from '../../model/Signpost';
import sortAndFilterPerfTableData from '../../functions/sortAndFilterPerfTableData';

interface UsePerfReportFilteringParams {
    data?: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    isNormalisationApplied: boolean;
    filters: PerfTableFilters;
    activeMathFilterList: TypedPerfTableRow['math_fidelity'][];
    activeRawOpCodeFilterList: TypedPerfTableRow['raw_op_code'][];
    activeBufferTypeFilterList: TypedPerfTableRow['buffer_type'][];
    activeLayoutFilterList: TypedPerfTableRow['layout'][];
    activeOpCategoryFilterList: TypedPerfTableRow['op_category'][];
    activeDurationBucketFilterList: DurationBucket['minUs'][];
    filterBySignpost: (Signpost | null)[];
}

interface UsePerfReportFilteringReturn {
    processedRows: TypedPerfTableRow[];
    processedComparisonRows: TypedPerfTableRow[][];
    combinedRows: TypedPerfTableRow[];
    rawOpCodeOptions: TypedPerfTableRow[];
    durationBucketOptions: DurationBucket[];
    emptyDurationBucketMinUsSet: ReadonlySet<DurationBucket['minUs']>;
    filteredRows: TypedPerfTableRow[];
    filteredComparisonRowsList: TypedPerfTableRow[][];
}

const getRawOpCodeOptions = (rows: TypedPerfTableRow[]): TypedPerfTableRow[] => {
    const opCodes = new Set<TypedPerfTableRow['raw_op_code']>();

    // Keep first row for each raw op code and skip signposts.
    return rows.filter((row) => {
        if (row.op_type === OpType.SIGNPOST || opCodes.has(row.raw_op_code)) {
            return false;
        }

        opCodes.add(row.raw_op_code);
        return true;
    });
};

// An empty set means the filter is off. Compare with null explicitly: BufferType.DRAM is 0.
const matchesSet = <T>(value: T | null, set: ReadonlySet<T>) => set.size === 0 || (value !== null && set.has(value));

const usePerfReportFiltering = ({
    data,
    comparisonData,
    isNormalisationApplied,
    filters,
    activeMathFilterList,
    activeRawOpCodeFilterList,
    activeBufferTypeFilterList,
    activeLayoutFilterList,
    activeOpCategoryFilterList,
    activeDurationBucketFilterList,
    filterBySignpost,
}: UsePerfReportFilteringParams): UsePerfReportFilteringReturn => {
    // Split inside the memo: destructuring the rest element in the render body would rebuild the
    // comparison array on every render even when the memo returns the same object, invalidating
    // combinedRows and every option set derived from it — two full passes over a report that can
    // run to hundreds of thousands of rows.
    const { processedRows, processedComparisonRows } = useMemo(() => {
        const rows = data || [];
        const compRows = comparisonData?.map((dataset) => dataset || []) || [];
        const [alignedRows, ...alignedComparisonRows] =
            isNormalisationApplied && rows.length > 0 && compRows.length > 0
                ? alignByOpCode(rows, compRows).data
                : [rows, ...compRows];

        return { processedRows: alignedRows, processedComparisonRows: alignedComparisonRows };
    }, [data, comparisonData, isNormalisationApplied]);

    const combinedRows = useMemo(
        () => [processedRows, ...processedComparisonRows].flat(),
        [processedRows, processedComparisonRows],
    );

    const rawOpCodeOptions = useMemo(() => getRawOpCodeOptions(combinedRows), [combinedRows]);
    // Built across every dataset so the option set — and therefore any selected tag — survives
    // switching comparison tabs, which swaps which report is primary.
    const durationBucketOptions = useMemo(() => buildLogDecadeBuckets(combinedRows), [combinedRows]);
    const emptyDurationBucketMinUsSet = useMemo(
        () => getEmptyBucketMinUs(combinedRows, durationBucketOptions),
        [combinedRows, durationBucketOptions],
    );
    const rawOpCodeFilterSet = useMemo(() => new Set(activeRawOpCodeFilterList), [activeRawOpCodeFilterList]);
    const mathFilterSet = useMemo(() => new Set(activeMathFilterList), [activeMathFilterList]);
    const bufferTypeFilterSet = useMemo(() => new Set(activeBufferTypeFilterList), [activeBufferTypeFilterList]);
    const layoutFilterSet = useMemo(() => new Set(activeLayoutFilterList), [activeLayoutFilterList]);
    const opCategoryFilterSet = useMemo(() => new Set(activeOpCategoryFilterList), [activeOpCategoryFilterList]);
    const durationBucketFilterSet = useMemo(
        () => new Set(activeDurationBucketFilterList),
        [activeDurationBucketFilterList],
    );
    const matchesDurationBucket = useCallback(
        (deviceTimeUs: TypedPerfTableRow['device_time']) =>
            isDurationInSelectedBuckets(deviceTimeUs, durationBucketOptions, durationBucketFilterSet),
        [durationBucketOptions, durationBucketFilterSet],
    );

    const { filteredRows, filteredComparisonRowsList } = useMemo(() => {
        // Every chip filter is resolved against the aligned rows, in both branches. Options come
        // from every dataset, so a value only a comparison row has must match there too, rather than
        // filtering the primary report alone and emptying both tables. One aligned row has to match
        // every active filter.
        const opCodeFilterValue = filters?.[ColumnKeys.OpCode]?.toLowerCase() || '';
        const hasOpCodeTextFilter = opCodeFilterValue.length > 0;
        const hasDurationFilter = durationBucketFilterSet.size > 0;
        const hasAlignedRowFilters =
            hasOpCodeTextFilter ||
            [
                rawOpCodeFilterSet,
                mathFilterSet,
                bufferTypeFilterSet,
                layoutFilterSet,
                opCategoryFilterSet,
                durationBucketFilterSet,
            ].some((filterSet) => filterSet.size > 0);
        const matchesAlignedRowFilters = (row: TypedPerfTableRow) =>
            (!hasOpCodeTextFilter || row.op_code.toLowerCase().includes(opCodeFilterValue)) &&
            matchesSet(row.raw_op_code, rawOpCodeFilterSet) &&
            matchesSet(row.math_fidelity, mathFilterSet) &&
            matchesSet(row.buffer_type, bufferTypeFilterSet) &&
            matchesSet(row.layout, layoutFilterSet) &&
            matchesSet(row.op_category, opCategoryFilterSet) &&
            (!hasDurationFilter || matchesDurationBucket(row.device_time));
        // The op code text filter is resolved on aligned rows above, so the per-dataset pass skips it.
        const filtersWithoutOpCode = {
            ...filters,
            [ColumnKeys.OpCode]: '',
        };

        if (!isNormalisationApplied) {
            const allDatasets = [processedRows, ...processedComparisonRows];
            const datasetsWithoutOpCodeFilter = allDatasets.map((dataset) =>
                sortAndFilterPerfTableData(dataset, {
                    filters: filtersWithoutOpCode,
                }),
            );
            const datasetRowSets = datasetsWithoutOpCodeFilter.map((dataset) => new Set(dataset));

            if (!hasAlignedRowFilters) {
                const [filteredSourceRows, ...filteredComparisonRows] = datasetsWithoutOpCodeFilter.map((dataset) =>
                    sortAndFilterPerfTableData(dataset, { filterBySignpost }),
                );

                return {
                    filteredRows: filteredSourceRows || [],
                    filteredComparisonRowsList: filteredComparisonRows,
                };
            }

            const maxDatasetLength = allDatasets.reduce((length, dataset) => Math.max(length, dataset.length), 0);
            const keepRowMask = Array.from({ length: maxDatasetLength }, (_, index) => {
                const alignedRows = allDatasets
                    .map((dataset, datasetIndex) => {
                        const row = dataset[index];
                        return row && datasetRowSets[datasetIndex].has(row) ? row : null;
                    })
                    .filter((value): value is TypedPerfTableRow => Boolean(value));

                return alignedRows.some(matchesAlignedRowFilters);
            });
            const [unifiedFilteredRows, ...unifiedFilteredComparisonRows] = allDatasets.map((dataset, datasetIndex) =>
                sortAndFilterPerfTableData(
                    dataset.filter((row, index) => datasetRowSets[datasetIndex].has(row) && keepRowMask[index]),
                    {
                        filterBySignpost,
                    },
                ),
            );

            return {
                filteredRows: unifiedFilteredRows || [],
                filteredComparisonRowsList: unifiedFilteredComparisonRows,
            };
        }

        const sourceRowsWithoutSignposts = sortAndFilterPerfTableData(processedRows, {
            filters: filtersWithoutOpCode,
        });
        const sourceRowSet = new Set(sourceRowsWithoutSignposts);
        const keepRowMask = processedRows.map((row, index) => {
            if (!sourceRowSet.has(row)) {
                return false;
            }

            if (!hasAlignedRowFilters) {
                return true;
            }

            // Checked in place rather than collecting the aligned rows: this runs once per row, on
            // reports that can run to hundreds of thousands of rows.
            return (
                matchesAlignedRowFilters(row) ||
                processedComparisonRows.some((dataset) => {
                    const alignedRow = dataset[index];

                    return Boolean(alignedRow) && matchesAlignedRowFilters(alignedRow);
                })
            );
        });

        const applyMask = (dataset: TypedPerfTableRow[]) => dataset.filter((_, index) => keepRowMask[index]);
        const filteredAlignedSourceRows = applyMask(processedRows);
        const filteredAlignedComparisonRows = processedComparisonRows.map(applyMask);

        return {
            filteredRows: sortAndFilterPerfTableData(filteredAlignedSourceRows, { filterBySignpost }),
            filteredComparisonRowsList: filteredAlignedComparisonRows.map((dataset) =>
                sortAndFilterPerfTableData(dataset, { filterBySignpost }),
            ),
        };
    }, [
        isNormalisationApplied,
        processedRows,
        filters,
        rawOpCodeFilterSet,
        mathFilterSet,
        bufferTypeFilterSet,
        layoutFilterSet,
        opCategoryFilterSet,
        durationBucketFilterSet,
        matchesDurationBucket,
        filterBySignpost,
        processedComparisonRows,
    ]);

    return {
        processedRows,
        processedComparisonRows,
        combinedRows,
        rawOpCodeOptions,
        durationBucketOptions,
        emptyDurationBucketMinUsSet,
        filteredRows,
        filteredComparisonRowsList,
    };
};

export default usePerfReportFiltering;
