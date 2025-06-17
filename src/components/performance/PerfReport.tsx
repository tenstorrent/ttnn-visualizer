// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { Icon, MenuItem, Size, Switch, Tab, TabId, Tabs, Tooltip } from '@blueprintjs/core';
import { MultiSelect } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { PerfTableRow, TableFilter, TableHeader, TableKeys } from '../../definitions/PerfTable';
import 'styles/components/PerfReport.scss';
import { useOpToPerfIdFiltered } from '../../hooks/useAPI';
import { calcHighDispatchOps } from '../../functions/perfFunctions';
import SearchField from '../SearchField';
import useTableFilter from '../../hooks/useTableFilter';
import PerfTable from './PerfTable';
import { activePerformanceReportAtom, comparisonPerformanceReportAtom } from '../../store/app';
import normalisePerformanceData, { MISSING_ROWS } from '../../functions/normalisePerformanceData';
import sortAndFilterPerfTableData, { TypedPerfTableRow } from '../../functions/sortAndFilterPerfTableData';

interface PerformanceReportProps {
    data?: PerfTableRow[];
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
    HIGH_DISPATCH = 'high_dispatch',
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

const PerformanceReport: FC<PerformanceReportProps> = ({ data, comparisonData }) => {
    const { getFilterOptions, updateFilters, activeFilters, FilterItem } = useTableFilter('math_fidelity', data || []);
    const opIdsMap = useOpToPerfIdFiltered();

    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const activeComparisonReports = useAtomValue(comparisonPerformanceReportAtom);

    const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState<boolean>(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState<boolean>(false);
    const [isMultiDevice, _setIsMultiDevice] = useState<boolean>(false);
    const [selectedTabId, setSelectedTabId] = useState<TabId>(INITIAL_TAB_ID);
    const [useNormalisedData, setUseNormalisedData] = useState(true);
    const [highlightRows, setHighlightRows] = useState<boolean>(true);

    const filterableColumnKeys = useMemo(
        () => TABLE_HEADERS.filter((column) => column.filterable).map((column) => column.key),
        [],
    );
    const [filters, setFilters] = useState<TableFilter>(
        Object.fromEntries(filterableColumnKeys.map((key) => [key, ''] as [TableKeys, string])) as Record<
            TableKeys,
            string
        >,
    );

    const comparisonIndex =
        (activeComparisonReports ?? []).findIndex((value) => value === selectedTabId) > -1
            ? (activeComparisonReports ?? []).findIndex((value) => value === selectedTabId)
            : 0;

    const processedRows: TypedPerfTableRow[] = useMemo(() => {
        return data ? enrichRowData(data, opIdsMap) : [];
    }, [data, opIdsMap]);

    const processedComparisonRows: TypedPerfTableRow[][] = useMemo(() => {
        return comparisonData ? comparisonData.map((dataset) => enrichRowData(dataset, opIdsMap)) : [];
    }, [comparisonData, opIdsMap]);

    const filteredRows = useMemo(() => {
        return sortAndFilterPerfTableData(processedRows, filters, filterableColumnKeys, activeFilters);
    }, [processedRows, filters, filterableColumnKeys, activeFilters]);

    const filteredComparisonRows = useMemo(() => {
        return sortAndFilterPerfTableData(
            processedComparisonRows[comparisonIndex],
            filters,
            filterableColumnKeys,
            activeFilters,
        );
    }, [comparisonIndex, processedComparisonRows, filters, filterableColumnKeys, activeFilters]);

    const updateColumnFilter = (key: TableKeys, value: string) => {
        setFilters({
            ...filters,
            [key]: value ?? '',
        } as Record<TableKeys, string>);
    };

    const normalisedData = useMemo(
        () =>
            processedRows && processedComparisonRows[0]
                ? normalisePerformanceData(processedRows, processedComparisonRows)
                : [],
        [processedRows, processedComparisonRows],
    );

    const totalDataLength =
        selectedTabId === INITIAL_TAB_ID ? data?.length : comparisonData?.[comparisonIndex]?.length || 0;
    const filteredDataLength =
        selectedTabId === INITIAL_TAB_ID ? filteredRows?.length : filteredComparisonRows?.length || 0;

    // Resets the state of things if we remove all comparison reports
    useEffect(() => {
        if (!activeComparisonReports) {
            setHighlightRows(false);
            setUseNormalisedData(false);
            setSelectedTabId(INITIAL_TAB_ID);
        }
    }, [activeComparisonReports]);

    useEffect(() => {
        if (activeComparisonReports && !activeComparisonReports.includes(selectedTabId as string)) {
            setSelectedTabId(INITIAL_TAB_ID);
        }
    }, [activeComparisonReports, selectedTabId]);

    return (
        <>
            <Switch
                label={!mergeDeviceData ? 'Expanded device data' : 'Merged device data'}
                onChange={() => setMergeDeviceData(!mergeDeviceData)}
                checked={mergeDeviceData && isMultiDevice}
                disabled={!isMultiDevice}
            />

            <Switch
                label='Show Matmul optimization analysis'
                onChange={() => setProvideMatmulAdvice(!provideMatmulAdvice)}
                checked={provideMatmulAdvice}
            />

            <Switch
                label='Highlight high dispatch ops'
                onChange={() => setHiliteHighDispatch(!hiliteHighDispatch)}
                checked={hiliteHighDispatch}
            />

            <Switch
                labelElement={
                    <Tooltip content='Tries to match up operations between the performance reports'>
                        <span className='switch-label-with-icon'>
                            <span>Normalise performance data</span>
                            <Icon icon={IconNames.SMALL_INFO_SIGN} />
                        </span>
                    </Tooltip>
                }
                onChange={() => setUseNormalisedData(!useNormalisedData)}
                checked={useNormalisedData}
                disabled={!activeComparisonReports}
            />

            <Switch
                labelElement={
                    <Tooltip content='Highlights rows where ops have been added or are missing after normalising the data'>
                        <span className='switch-label-with-icon'>
                            <span>Highlight row difference</span>
                            <Icon icon={IconNames.SMALL_INFO_SIGN} />
                        </span>
                    </Tooltip>
                }
                onChange={() => setHighlightRows(!highlightRows)}
                checked={highlightRows}
                disabled={!activeComparisonReports || !useNormalisedData}
            />

            <div className='perf-report'>
                <div className='table-header'>
                    <h3 className='title'>Performance report</h3>

                    <div className='header-aside'>
                        <p className='result-count'>
                            {filteredDataLength !== totalDataLength
                                ? `Showing ${filteredDataLength} of ${totalDataLength} rows`
                                : `Showing ${filteredDataLength} rows`}
                        </p>
                    </div>
                </div>

                <div className='filters'>
                    {filterableColumnKeys.map((key) => (
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
                        noResults={
                            <MenuItem
                                disabled
                                text='No results.'
                                roleStructure='listoption'
                            />
                        }
                        resetOnSelect
                    />

                    {/* Need to refactor to have the reset working */}
                    {/* <Button
                        onClick={() => changeSorting(null)(null)}
                        variant={ButtonVariant.OUTLINED}
                        disabled={sortingColumn === null}
                    >
                        Reset sort
                    </Button> */}
                </div>

                <Tabs
                    selectedTabId={selectedTabId}
                    onChange={setSelectedTabId}
                    renderActiveTabPanelOnly
                    size={Size.LARGE}
                >
                    <Tab
                        id={INITIAL_TAB_ID}
                        title={activePerformanceReport}
                        icon={IconNames.TH_LIST}
                        panel={
                            <PerfTable
                                data={useNormalisedData ? normalisedData[0] : filteredRows}
                                comparisonData={
                                    useNormalisedData && normalisedData?.[1]?.[comparisonIndex]
                                        ? normalisedData[1][comparisonIndex]
                                        : []
                                }
                                filters={filters}
                                provideMatmulAdvice={provideMatmulAdvice}
                                hiliteHighDispatch={hiliteHighDispatch}
                                matches={MISSING_ROWS}
                                highlightRows={highlightRows && useNormalisedData}
                                normaliseData={useNormalisedData}
                            />
                        }
                    />

                    {activeComparisonReports
                        ?.filter((report) => report)
                        .map((report, index) => (
                            <Tab
                                id={report}
                                key={index}
                                title={report}
                                icon={IconNames.TH_LIST}
                                panel={
                                    <PerfTable
                                        // TODO: Enforcing restrictions on comparison data based on index
                                        data={
                                            useNormalisedData &&
                                            normalisedData?.[1]?.[comparisonIndex] &&
                                            comparisonIndex < 1
                                                ? normalisedData[1][comparisonIndex]
                                                : filteredComparisonRows
                                        }
                                        comparisonData={
                                            // TODO: Enforcing restrictions on comparison data based on index
                                            useNormalisedData && normalisedData?.[0] && comparisonIndex < 1
                                                ? normalisedData[0]
                                                : []
                                        }
                                        filters={filters}
                                        provideMatmulAdvice={provideMatmulAdvice}
                                        hiliteHighDispatch={hiliteHighDispatch}
                                        matches={MISSING_ROWS}
                                        highlightRows={highlightRows && useNormalisedData}
                                        normaliseData={useNormalisedData}
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

export default PerformanceReport;
