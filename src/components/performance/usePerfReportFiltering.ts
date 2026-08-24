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

const usePerfReportFiltering = ({
    data,
    comparisonData,
    isNormalisationApplied,
    filters,
    activeMathFilterList,
    activeRawOpCodeFilterList,
    activeBufferTypeFilterList,
    activeLayoutFilterList,
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
    const activeMathFilters = useMemo(() => activeMathFilterList, [activeMathFilterList]);
    const mathFilterSet = useMemo(() => new Set(activeMathFilters), [activeMathFilters]);
    const activeBufferTypeFilters = useMemo(() => activeBufferTypeFilterList, [activeBufferTypeFilterList]);
    const bufferTypeFilterSet = useMemo(() => new Set(activeBufferTypeFilters), [activeBufferTypeFilters]);
    const activeLayoutFilters = useMemo(() => activeLayoutFilterList, [activeLayoutFilterList]);
    const layoutFilterSet = useMemo(() => new Set(activeLayoutFilters), [activeLayoutFilters]);
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
        if (!isNormalisationApplied) {
            const opCodeFilterValue = filters?.[ColumnKeys.OpCode]?.toLowerCase() || '';
            const hasOpCodeTextFilter = opCodeFilterValue.length > 0;
            const hasRawOpCodeFilter = rawOpCodeFilterSet.size > 0;
            const hasMathFilter = activeMathFilters.length > 0;
            const hasBufferTypeFilter = activeBufferTypeFilters.length > 0;
            const hasLayoutFilter = activeLayoutFilters.length > 0;
            const hasDurationFilter = durationBucketFilterSet.size > 0;
            const hasCrossReportFilters =
                hasOpCodeTextFilter ||
                hasRawOpCodeFilter ||
                hasMathFilter ||
                hasBufferTypeFilter ||
                hasLayoutFilter ||
                hasDurationFilter;
            const filtersWithoutCrossReportFilters = {
                ...filters,
                [ColumnKeys.OpCode]: '',
            };
            const allDatasets = [processedRows, ...processedComparisonRows];
            const datasetsWithoutCrossReportFilters = allDatasets.map((dataset) =>
                sortAndFilterPerfTableData(dataset, {
                    filters: filtersWithoutCrossReportFilters,
                }),
            );
            const datasetRowSets = datasetsWithoutCrossReportFilters.map((dataset) => new Set(dataset));

            if (!hasCrossReportFilters) {
                const [filteredSourceRows, ...filteredComparisonRows] = datasetsWithoutCrossReportFilters.map(
                    (dataset) => sortAndFilterPerfTableData(dataset, { filterBySignpost }),
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

                return alignedRows.some((alignedRow) => {
                    const matchesOpCodeText = hasOpCodeTextFilter
                        ? alignedRow.op_code.toLowerCase().includes(opCodeFilterValue)
                        : true;
                    const matchesRawOpCode = hasRawOpCodeFilter
                        ? alignedRow.raw_op_code !== null && rawOpCodeFilterSet.has(alignedRow.raw_op_code)
                        : true;
                    const matchesMathFidelity = hasMathFilter
                        ? alignedRow.math_fidelity !== null && mathFilterSet.has(alignedRow.math_fidelity)
                        : true;
                    const matchesBufferType = hasBufferTypeFilter
                        ? alignedRow.buffer_type !== null && bufferTypeFilterSet.has(alignedRow.buffer_type)
                        : true;
                    const matchesLayout = hasLayoutFilter
                        ? alignedRow.layout !== null && layoutFilterSet.has(alignedRow.layout)
                        : true;
                    const matchesDuration = hasDurationFilter ? matchesDurationBucket(alignedRow.device_time) : true;

                    return (
                        matchesOpCodeText &&
                        matchesRawOpCode &&
                        matchesMathFidelity &&
                        matchesBufferType &&
                        matchesLayout &&
                        matchesDuration
                    );
                });
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

        const opCodeFilterValue = filters?.[ColumnKeys.OpCode]?.toLowerCase() || '';
        const hasOpCodeTextFilter = opCodeFilterValue.length > 0;
        const hasRawOpCodeFilter = rawOpCodeFilterSet.size > 0;
        const hasDurationFilter = durationBucketFilterSet.size > 0;
        // Every filter resolved against the aligned rows rather than per dataset
        const hasAlignedRowFilters = hasOpCodeTextFilter || hasRawOpCodeFilter || hasDurationFilter;
        const filtersWithoutOpCode = {
            ...filters,
            [ColumnKeys.OpCode]: '',
        };
        const sourceRowsWithoutSignposts = sortAndFilterPerfTableData(processedRows, {
            filters: filtersWithoutOpCode,
            mathFilter: activeMathFilters,
            bufferTypeFilter: activeBufferTypeFilters,
            activeLayoutFilterList: activeLayoutFilters,
        });
        const sourceRowSet = new Set(sourceRowsWithoutSignposts);
        const keepRowMask = processedRows.map((row, index) => {
            if (!sourceRowSet.has(row)) {
                return false;
            }

            if (!hasAlignedRowFilters) {
                return true;
            }

            const alignedRows = [
                row,
                ...processedComparisonRows
                    .map((dataset) => dataset[index])
                    .filter((value): value is TypedPerfTableRow => Boolean(value)),
            ];

            return alignedRows.some((alignedRow) => {
                const matchesOpCodeText = hasOpCodeTextFilter
                    ? alignedRow.op_code.toLowerCase().includes(opCodeFilterValue)
                    : true;
                const matchesRawOpCode = hasRawOpCodeFilter
                    ? alignedRow.raw_op_code !== null && rawOpCodeFilterSet.has(alignedRow.raw_op_code)
                    : true;
                const matchesDuration = hasDurationFilter ? matchesDurationBucket(alignedRow.device_time) : true;

                return matchesOpCodeText && matchesRawOpCode && matchesDuration;
            });
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
        activeMathFilters,
        rawOpCodeFilterSet,
        activeBufferTypeFilters,
        activeLayoutFilters,
        mathFilterSet,
        bufferTypeFilterSet,
        layoutFilterSet,
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
