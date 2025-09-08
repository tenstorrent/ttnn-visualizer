// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MenuItem, PopoverPosition, Position, Size, Switch, Tab, TabId, Tabs, Tooltip } from '@blueprintjs/core';
import { MultiSelect } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { PerfTableRow, StackedPerfRow, TableFilter, TableHeader, TableKeys } from '../../definitions/PerfTable';
import { useOpToPerfIdFiltered } from '../../hooks/useAPI';
import { calcHighDispatchOps } from '../../functions/perfFunctions';
import SearchField from '../SearchField';
import useTableFilter from '../../hooks/useTableFilter';
import PerfTable from './PerfTable';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import alignByOpCode from '../../functions/normalisePerformanceData';
import sortAndFilterPerfTableData, { TypedPerfTableRow } from '../../functions/sortAndFilterPerfTableData';
import 'styles/components/PerfReport.scss';
import StackedPerformanceTable from './StackedPerfTable';
import { TypedStackedPerfRow } from '../../functions/sortAndFilterStackedPerfTableData';

interface PerformanceReportProps {
    data?: PerfTableRow[];
    stackedData?: StackedPerfRow[];
    comparisonData?: PerfTableRow[][];
}

enum COLUMN_HEADERS {
    id = 'id',
    total_percent = 'total_percent',
    bound = 'bound',
    op_code = 'op_code',
    device_time = 'device_time',
    op_to_op_gap = 'op_to_op_gap',
    cores = 'cores',
    dram = 'dram',
    dram_percent = 'dram_percent',
    flops = 'flops',
    flops_percent = 'flops_percent',
    math_fidelity = 'math_fidelity',
    OP = 'op',
    high_dispatch = 'high_dispatch',
    global_call_count = 'global_call_count',
}

const TABLE_HEADERS: TableHeader[] = [
    { label: 'ID', key: COLUMN_HEADERS.id, sortable: true },
    { label: 'Total %', key: COLUMN_HEADERS.total_percent, unit: '%', decimals: 1, sortable: true },
    { label: 'Bound', key: COLUMN_HEADERS.bound, colour: 'yellow' },
    { label: 'OP Code', key: COLUMN_HEADERS.op_code, colour: 'blue', sortable: true, filterable: true },
    { label: 'Device Time', key: COLUMN_HEADERS.device_time, unit: 'µs', decimals: 0, sortable: true },
    { label: 'Op-to-Op Gap', key: COLUMN_HEADERS.op_to_op_gap, colour: 'red', unit: 'µs', decimals: 0, sortable: true },
    { label: 'Cores', key: COLUMN_HEADERS.cores, colour: 'green', sortable: true },
    { label: 'DRAM', key: COLUMN_HEADERS.dram, colour: 'yellow', unit: 'GB/s', sortable: true },
    { label: 'DRAM %', key: COLUMN_HEADERS.dram_percent, colour: 'yellow', unit: '%', sortable: true },
    { label: 'FLOPs', key: COLUMN_HEADERS.flops, unit: 'TFLOPs', sortable: true },
    { label: 'FLOPs %', key: COLUMN_HEADERS.flops_percent, unit: '%', sortable: true },
    { label: 'Math Fidelity', key: COLUMN_HEADERS.math_fidelity, colour: 'cyan' },
];

const INITIAL_TAB_ID = 'perf-table-0';
const FILTERABLE_COLUMN_KEYS = TABLE_HEADERS.filter((column) => column.filterable).map((column) => column.key);

const PerformanceReport: FC<PerformanceReportProps> = ({ data, stackedData, comparisonData }) => {
    const { getFilterOptions, updateFilters, activeFilters, FilterItem } = useTableFilter('math_fidelity', data || []);
    const opIdsMap = useOpToPerfIdFiltered();

    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const activeComparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);

    // TODO: Reimplement merge/expand device data toggle
    // const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    // const [isMultiDevice, _setIsMultiDevice] = useState<boolean>(false);
    const [isStackedView, setIsStackedView] = useState<boolean>(false);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState<boolean>(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState<boolean>(false);
    const [selectedTabId, setSelectedTabId] = useState<TabId>(INITIAL_TAB_ID);
    const [useNormalisedData, setUseNormalisedData] = useState(true);
    const [highlightRows, setHighlightRows] = useState<boolean>(true);
    const [filters, setFilters] = useState<TableFilter>(
        Object.fromEntries(FILTERABLE_COLUMN_KEYS.map((key) => [key, ''] as [TableKeys, string])) as Record<
            TableKeys,
            string
        >,
    );

    const comparisonIndex = (activeComparisonReportList ?? []).findIndex((value) => value === selectedTabId);

    const processedRows: TypedPerfTableRow[] = useMemo(() => {
        return data ? enrichRowData(data, opIdsMap) : [];
    }, [data, opIdsMap]);

    const processedComparisonRows: TypedPerfTableRow[][] = useMemo(() => {
        return comparisonData ? comparisonData.map((dataset) => enrichRowData(dataset, opIdsMap)) : [];
    }, [comparisonData, opIdsMap]);

    const processedStackedRows: TypedStackedPerfRow[] = useMemo(() => {
        return stackedData ? enrichStackedRowData(stackedData) : [];
    }, [stackedData]);

    const normalisedData = useMemo(
        () =>
            processedRows?.length > 0 && processedComparisonRows?.length > 0
                ? alignByOpCode(processedRows, processedComparisonRows)
                : { data: [], missingRows: [] },
        [processedRows, processedComparisonRows],
    );
    const normalisedComparisonData = normalisedData.data.slice(1);

    const filteredRows = useMemo(
        () =>
            sortAndFilterPerfTableData(
                useNormalisedData ? normalisedData.data[0] : processedRows,
                filters,
                FILTERABLE_COLUMN_KEYS,
                activeFilters,
            ),
        [processedRows, filters, activeFilters, useNormalisedData, normalisedData.data],
    );

    const filteredComparisonRows = useMemo(
        () =>
            sortAndFilterPerfTableData(
                useNormalisedData ? normalisedData.data[comparisonIndex] : processedComparisonRows[comparisonIndex],
                filters,
                FILTERABLE_COLUMN_KEYS,
                activeFilters,
            ),
        [comparisonIndex, processedComparisonRows, filters, activeFilters, useNormalisedData, normalisedData.data],
    );

    const updateColumnFilter = (key: TableKeys, value: string) => {
        setFilters({
            ...filters,
            [key]: value ?? '',
        } as Record<TableKeys, string>);
    };

    const totalDataLength = getTotalDataLength(
        useNormalisedData,
        normalisedData,
        selectedTabId,
        data,
        comparisonData?.[comparisonIndex],
    );
    const filteredDataLength = getFilteredDataLength(selectedTabId, filteredRows, filteredComparisonRows);
    const rowDelta = useMemo(() => {
        if (!useNormalisedData) {
            return 0;
        }

        if (selectedTabId === INITIAL_TAB_ID) {
            return processedRows.length - (normalisedData.data?.[0]?.length || 0);
        }

        if (processedComparisonRows?.[comparisonIndex] && normalisedData.data?.[comparisonIndex + 1]) {
            return processedComparisonRows[comparisonIndex].length - normalisedData.data[comparisonIndex + 1].length;
        }

        return 0;
    }, [
        useNormalisedData,
        selectedTabId,
        processedRows,
        normalisedData.data,
        comparisonIndex,
        processedComparisonRows,
    ]);

    // Resets various state if we remove all comparison reports
    useEffect(() => {
        if (!activeComparisonReportList?.includes(selectedTabId as string) && selectedTabId !== INITIAL_TAB_ID) {
            setSelectedTabId(INITIAL_TAB_ID);
        }

        if (!activeComparisonReportList) {
            setUseNormalisedData(false);
        }
    }, [activeComparisonReportList, selectedTabId]);

    // If currently selected tab is disabled, reset to initial tab
    useEffect(() => {
        const isSelectedTabDisabled =
            useNormalisedData && normalisedData?.data?.slice(1)?.[comparisonIndex]?.length === 0;

        if (isSelectedTabDisabled) {
            setSelectedTabId(INITIAL_TAB_ID);
        }
    }, [selectedTabId, useNormalisedData, normalisedData, comparisonIndex]);

    return (
        <>
            {/* See note above by the useState declarations */}
            {/* <Switch
                label={!mergeDeviceData ? 'Expanded device data' : 'Merged device data'}
                onChange={() => setMergeDeviceData(!mergeDeviceData)}
                checked={mergeDeviceData && isMultiDevice}
                disabled={!isMultiDevice}
            /> */}

            <div className='perf-report'>
                <div className='table-header'>
                    <h3 className='title'>Performance report</h3>

                    <div className='header-aside'>
                        <p className='result-count'>
                            {filteredDataLength !== totalDataLength
                                ? `Showing ${filteredDataLength} of ${totalDataLength} rows`
                                : `Showing ${filteredDataLength} rows`}

                            {useNormalisedData && rowDelta
                                ? ` (${rowDelta > 0 ? `${rowDelta} ops removed` : `${rowDelta * -1} ops added`})`
                                : null}
                        </p>
                    </div>
                </div>

                <div className='filters'>
                    {FILTERABLE_COLUMN_KEYS.map((key) => (
                        <SearchField
                            key={key}
                            onQueryChanged={(value) => updateColumnFilter(key, value)}
                            placeholder={`Filter ${TABLE_HEADERS.find((header) => header.key === key)?.label}`}
                            searchQuery={filters?.[key] || ''}
                        />
                    ))}

                    <MultiSelect
                        items={data ? getFilterOptions() : []}
                        placeholder='Math fidelity filter...'
                        // Type requires this but it seems pointless
                        onItemSelect={(selectedType) => updateFilters(selectedType)}
                        selectedItems={activeFilters}
                        itemRenderer={(value: string | number, _props) => FilterItem(String(value))}
                        tagRenderer={(mathFidelity) => mathFidelity}
                        onRemove={(type) => updateFilters(type)}
                        itemPredicate={(query, mathFidelity) =>
                            !query || String(mathFidelity).toLowerCase().includes(query.toLowerCase())
                        }
                        disabled={isStackedView}
                        noResults={
                            <MenuItem
                                disabled
                                text='No results.'
                                roleStructure='listoption'
                            />
                        }
                        resetOnSelect
                    />
                </div>

                <div className='data-options'>
                    <Switch
                        label='Stacked display'
                        onChange={() => setIsStackedView(!isStackedView)}
                        checked={isStackedView}
                    />

                    <Switch
                        label='Matmul optimization analysis'
                        onChange={() => setProvideMatmulAdvice(!provideMatmulAdvice)}
                        checked={provideMatmulAdvice}
                    />

                    <Switch
                        label='Highlight high dispatch ops'
                        onChange={() => setHiliteHighDispatch(!hiliteHighDispatch)}
                        checked={hiliteHighDispatch}
                    />

                    <Tooltip
                        content='Tries to match up operations between the performance reports'
                        position={Position.TOP}
                    >
                        <Switch
                            label='Normalise data'
                            disabled={!activeComparisonReportList}
                            onChange={() => setUseNormalisedData(!useNormalisedData)}
                            checked={useNormalisedData}
                        />
                    </Tooltip>

                    {activeComparisonReportList && useNormalisedData && (
                        <Tooltip
                            content='Highlights rows where ops have been added or are missing after normalising the data'
                            position={Position.TOP}
                        >
                            <Switch
                                label='Highlight row differences'
                                onChange={() => setHighlightRows(!highlightRows)}
                                disabled={!activeComparisonReportList || !useNormalisedData}
                                checked={highlightRows}
                            />
                        </Tooltip>
                    )}
                </div>

                <Tabs
                    selectedTabId={selectedTabId}
                    onChange={setSelectedTabId}
                    renderActiveTabPanelOnly
                    size={Size.LARGE}
                    id='performance-tabs'
                >
                    <Tab
                        id={INITIAL_TAB_ID}
                        title={activePerformanceReport}
                        icon={IconNames.TH_LIST}
                        className='tab-panel'
                        panel={
                            isStackedView ? (
                                <StackedPerformanceTable
                                    data={useNormalisedData ? normalisedData.data[0] : filteredRows}
                                    stackedData={processedStackedRows}
                                    filters={filters}
                                />
                            ) : (
                                <PerfTable
                                    data={useNormalisedData ? normalisedData.data[0] : filteredRows}
                                    comparisonData={
                                        useNormalisedData && normalisedComparisonData.length > 0
                                            ? normalisedComparisonData
                                            : []
                                    }
                                    filters={filters}
                                    mathFidelityFilter={activeFilters}
                                    provideMatmulAdvice={provideMatmulAdvice}
                                    hiliteHighDispatch={hiliteHighDispatch}
                                    shouldHighlightRows={highlightRows && useNormalisedData}
                                />
                            )
                        }
                    />

                    {activeComparisonReportList?.map((report, index) => (
                        <Tab
                            id={report}
                            key={index}
                            icon={IconNames.TH_LIST}
                            className='tab-panel'
                            disabled={useNormalisedData && normalisedComparisonData?.[index]?.length === 0}
                            title={
                                normalisedData?.data?.slice(1)?.[index]?.length === 0 ? (
                                    <Tooltip
                                        content='Report has too many differences to be normalised'
                                        position={PopoverPosition.TOP}
                                    >
                                        {report}
                                    </Tooltip>
                                ) : (
                                    report
                                )
                            }
                            panel={
                                <PerfTable
                                    data={
                                        useNormalisedData && normalisedComparisonData.length > 0
                                            ? normalisedComparisonData[comparisonIndex]
                                            : filteredComparisonRows
                                    }
                                    comparisonData={
                                        useNormalisedData && normalisedData.data.length > 1
                                            ? normalisedData.data.filter((_, i) => i !== comparisonIndex + 1)
                                            : []
                                    }
                                    filters={filters}
                                    mathFidelityFilter={activeFilters}
                                    provideMatmulAdvice={provideMatmulAdvice}
                                    hiliteHighDispatch={hiliteHighDispatch}
                                    shouldHighlightRows={highlightRows && useNormalisedData}
                                    reportName={report}
                                />
                            }
                        />
                    ))}
                </Tabs>
            </div>

            <hr />

            {hiliteHighDispatch && calcHighDispatchOps(processedRows)}
        </>
    );
};

const HIGH_DISPATCH_THRESHOLD = 6.5;

const enrichRowData = (rows: PerfTableRow[], opIdsMap: { perfId?: string; opId: number }[]): TypedPerfTableRow[] => {
    return rows.map((row) => {
        const val = parseInt(row.op_to_op_gap, 10);
        const opStr = opIdsMap.find((opMap) => opMap.perfId === row.id)?.opId;
        const op = opStr !== undefined ? Number(opStr) : undefined;

        return {
            ...row,
            op,
            high_dispatch: !!val && val > HIGH_DISPATCH_THRESHOLD,
            id: parseInt(row.id, 10),
            total_percent: parseFloat(row.total_percent),
            device_time: parseFloat(row.device_time),
            op_to_op_gap: row.op_to_op_gap ? parseFloat(row.op_to_op_gap) : null,
            cores: parseInt(row.cores, 10),
            dram: row.dram ? parseFloat(row.dram) : null,
            dram_percent: row.dram_percent ? parseFloat(row.dram_percent) : null,
            flops: row.flops ? parseFloat(row.flops) : null,
            flops_percent: row.flops_percent ? parseFloat(row.flops_percent) : null,
        };
    });
};

const enrichStackedRowData = (rows: StackedPerfRow[]): TypedStackedPerfRow[] =>
    rows.map((row) => ({
        ...row,
        percent: parseFloat(row.percent),
        device_time_sum_us: parseFloat(row.device_time_sum_us),
        ops_count: parseFloat(row.ops_count),
        flops_min: row.flops_min ? parseFloat(row.flops_min) : null,
        flops_max: row.flops_max ? parseFloat(row.flops_max) : null,
        flops_mean: row.flops_mean ? parseFloat(row.flops_mean) : null,
        flops_std: row.flops_std ? parseFloat(row.flops_std) : null,
    }));

const getTotalDataLength = (
    useNormalisedData: boolean,
    normalisedData: { data: TypedPerfTableRow[][] },
    selectedTabId: TabId,
    data?: PerfTableRow[],
    comparisonData?: PerfTableRow[],
) => {
    if (useNormalisedData) {
        return normalisedData.data[0]?.length || 0;
    }

    if (selectedTabId === INITIAL_TAB_ID) {
        return data?.length || 0;
    }

    return comparisonData?.length || 0;
};

const getFilteredDataLength = (
    selectedTabId: TabId,
    filteredRows: TypedPerfTableRow[],
    filteredComparisonRows: TypedPerfTableRow[],
) => (selectedTabId === INITIAL_TAB_ID ? filteredRows?.length : filteredComparisonRows?.length || 0);

export default PerformanceReport;
