// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { ColumnKeys, PerfTableFilters, TypedPerfTableRow } from '../../definitions/PerfTable';
import { OpType } from '../../definitions/Performance';
import alignByOpCode from '../../functions/normalisePerformanceData';
import { Signpost } from '../../functions/perfFunctions';
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
    filterBySignpost: (Signpost | null)[];
}

interface UsePerfReportFilteringReturn {
    processedRows: TypedPerfTableRow[];
    processedComparisonRows: TypedPerfTableRow[][];
    combinedRows: TypedPerfTableRow[];
    rawOpCodeOptions: TypedPerfTableRow[];
    effectiveRawOpCodeFilterList: string[];
    filteredRows: TypedPerfTableRow[];
    filteredComparisonRowsList: TypedPerfTableRow[][];
}

const getRawOpCodeOptions = (rows: TypedPerfTableRow[]): TypedPerfTableRow[] => {
    // Don't want signposts here
    const options = rows.filter((row) => row.op_type !== OpType.SIGNPOST);

    return Array.from(new Set(options));
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
    filterBySignpost,
}: UsePerfReportFilteringParams): UsePerfReportFilteringReturn => {
    const {
        data: [processedRows, ...processedComparisonRows],
    } = useMemo(() => {
        const rows = data || [];
        const compRows = comparisonData?.map((dataset) => dataset || []) || [];

        if (isNormalisationApplied && rows.length > 0 && compRows.length > 0) {
            return alignByOpCode(rows, compRows);
        }

        return { data: [rows, ...compRows], missingRows: [] };
    }, [data, comparisonData, isNormalisationApplied]);

    const combinedRows = useMemo(
        () => [processedRows, ...processedComparisonRows].flat(),
        [processedRows, processedComparisonRows],
    );
    const rawOpCodeOptions = useMemo(() => getRawOpCodeOptions(combinedRows), [combinedRows]);
    const availableRawOpCodeOptionSet = useMemo(
        () =>
            new Set(rawOpCodeOptions.map((row) => row.raw_op_code).filter((value): value is string => value !== null)),
        [rawOpCodeOptions],
    );
    const effectiveRawOpCodeFilterList = useMemo(
        () => activeRawOpCodeFilterList.filter((value): value is string => availableRawOpCodeOptionSet.has(value)),
        [activeRawOpCodeFilterList, availableRawOpCodeOptionSet],
    );
    const availableMathOptionSet = useMemo(
        () =>
            new Set(
                combinedRows
                    .map((row) => row.math_fidelity)
                    .filter((value): value is string => value !== null && value !== ''),
            ),
        [combinedRows],
    );
    const effectiveMathFilterList = useMemo(
        () =>
            activeMathFilterList.filter(
                (value): value is string => value !== null && availableMathOptionSet.has(value),
            ),
        [activeMathFilterList, availableMathOptionSet],
    );
    const availableBufferTypeOptionSet = useMemo(
        () =>
            new Set(
                combinedRows
                    .map((row) => row.buffer_type)
                    .filter((value): value is NonNullable<TypedPerfTableRow['buffer_type']> => value !== null),
            ),
        [combinedRows],
    );
    const effectiveBufferTypeFilterList = useMemo(
        () =>
            activeBufferTypeFilterList.filter(
                (value): value is NonNullable<TypedPerfTableRow['buffer_type']> =>
                    value !== null && availableBufferTypeOptionSet.has(value),
            ),
        [activeBufferTypeFilterList, availableBufferTypeOptionSet],
    );
    const availableLayoutOptionSet = useMemo(
        () =>
            new Set(
                combinedRows
                    .map((row) => row.layout)
                    .filter((value): value is NonNullable<TypedPerfTableRow['layout']> => value !== null),
            ),
        [combinedRows],
    );
    const effectiveLayoutFilterList = useMemo(
        () =>
            activeLayoutFilterList.filter(
                (value): value is NonNullable<TypedPerfTableRow['layout']> =>
                    value !== null && availableLayoutOptionSet.has(value),
            ),
        [activeLayoutFilterList, availableLayoutOptionSet],
    );
    const activeMathFilters = useMemo(
        () => (isNormalisationApplied ? [] : effectiveMathFilterList),
        [isNormalisationApplied, effectiveMathFilterList],
    );
    const activeBufferTypeFilters = useMemo(
        () => (isNormalisationApplied ? [] : effectiveBufferTypeFilterList),
        [isNormalisationApplied, effectiveBufferTypeFilterList],
    );
    const activeLayoutFilters = useMemo(
        () => (isNormalisationApplied ? [] : effectiveLayoutFilterList),
        [isNormalisationApplied, effectiveLayoutFilterList],
    );

    const { filteredRows, filteredComparisonRowsList } = useMemo(() => {
        if (!isNormalisationApplied) {
            const opCodeFilterValue = filters?.[ColumnKeys.OpCode]?.toLowerCase() || '';
            const hasOpCodeTextFilter = opCodeFilterValue.length > 0;
            const hasRawOpCodeFilter = effectiveRawOpCodeFilterList.length > 0;
            const hasMathFilter = activeMathFilters.length > 0;
            const hasBufferTypeFilter = activeBufferTypeFilters.length > 0;
            const hasLayoutFilter = activeLayoutFilters.length > 0;
            const hasCrossReportFilters =
                hasOpCodeTextFilter || hasRawOpCodeFilter || hasMathFilter || hasBufferTypeFilter || hasLayoutFilter;
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
                        ? alignedRow.raw_op_code !== null &&
                          effectiveRawOpCodeFilterList.includes(alignedRow.raw_op_code)
                        : true;
                    const matchesMathFidelity = hasMathFilter
                        ? alignedRow.math_fidelity !== null && activeMathFilters.includes(alignedRow.math_fidelity)
                        : true;
                    const matchesBufferType = hasBufferTypeFilter
                        ? alignedRow.buffer_type !== null && activeBufferTypeFilters.includes(alignedRow.buffer_type)
                        : true;
                    const matchesLayout = hasLayoutFilter
                        ? alignedRow.layout !== null && activeLayoutFilters.includes(alignedRow.layout)
                        : true;

                    return (
                        matchesOpCodeText &&
                        matchesRawOpCode &&
                        matchesMathFidelity &&
                        matchesBufferType &&
                        matchesLayout
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
        const hasRawOpCodeFilter = effectiveRawOpCodeFilterList.length > 0;
        const hasOpFilters = hasOpCodeTextFilter || hasRawOpCodeFilter;
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

            if (!hasOpFilters) {
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
                    ? alignedRow.raw_op_code !== null && effectiveRawOpCodeFilterList.includes(alignedRow.raw_op_code)
                    : true;

                return matchesOpCodeText && matchesRawOpCode;
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
        effectiveRawOpCodeFilterList,
        activeBufferTypeFilters,
        activeLayoutFilters,
        filterBySignpost,
        processedComparisonRows,
    ]);

    return {
        processedRows,
        processedComparisonRows,
        combinedRows,
        rawOpCodeOptions,
        effectiveRawOpCodeFilterList,
        filteredRows,
        filteredComparisonRowsList,
    };
};

export default usePerfReportFiltering;
