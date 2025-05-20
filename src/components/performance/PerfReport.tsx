// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { Button, ButtonVariant, MenuItem, Size, Switch, Tab, TabId, Tabs } from '@blueprintjs/core';
import { MultiSelect } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { PerfTableRow, TableHeader, TableKeys } from '../../definitions/PerfTable';
import 'styles/components/PerfReport.scss';
import { useOptoPerfIdFiltered } from '../../hooks/useAPI';
import { calcHighDispatchOps } from '../../functions/perfFunctions';
import useSortTable from '../../hooks/useSortTable';
import SearchField from '../SearchField';
import useTableFilter from '../../hooks/useTableFilter';
import PerfTable from './PerfTable';
import { activePerformanceReportAtom, comparisonPerformanceReportAtom } from '../../store/app';

interface PerformanceReportProps {
    data?: PerfTableRow[];
    comparisonData?: PerfTableRow[];
}

interface TypedPerfTableRow
    extends Omit<
        PerfTableRow,
        | 'id'
        | 'total_percent'
        | 'device_time'
        | 'op_to_op_gap'
        | 'cores'
        | 'dram'
        | 'dram_percent'
        | 'flops'
        | 'flops_percent'
    > {
    id: number;
    total_percent: number;
    device_time: number;
    op_to_op_gap: number | null;
    cores: number;
    dram: number;
    dram_percent: number;
    flops: number;
    flops_percent: number;
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

const PerformanceReport: FC<PerformanceReportProps> = ({ data, comparisonData }) => {
    const { getFilterOptions, updateFilters, activeFilters, FilterItem } = useTableFilter('math_fidelity', data || []);
    const { sortTableFields, changeSorting, sortingColumn } = useSortTable(null);
    const opIdsMap = useOptoPerfIdFiltered();

    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const activeComparisonReport = useAtomValue(comparisonPerformanceReportAtom);
    const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState<boolean>(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState<boolean>(false);
    const [isMultiDevice, _setIsMultiDevice] = useState<boolean>(false);
    const [selectedTabId, setSelectedTabId] = useState<TabId>('perf-table-1');

    const filterableColumnKeys = useMemo(
        () => TABLE_HEADERS.filter((column) => column.filterable).map((column) => column.key),
        [],
    );
    const [filters, setFilters] = useState<Record<TableKeys, string> | null>(
        Object.fromEntries(filterableColumnKeys.map((key) => [key, ''] as [TableKeys, string])) as Record<
            TableKeys,
            string
        >,
    );

    const processedRows: PerfTableRow[] = useMemo(() => {
        return (
            data?.map((opData) => {
                const val = parseInt(opData.op_to_op_gap, 10);
                const op = opIdsMap.find((opMap) => opMap.perfId === opData.id)?.opId;
                return {
                    ...opData,
                    high_dispatch: !!val && val > 6.5,
                    op,
                };
            }) || []
        );
    }, [data, opIdsMap]);

    const processedComparisonRows: PerfTableRow[] = useMemo(() => {
        return (
            comparisonData?.map((opData) => {
                const val = parseInt(opData.op_to_op_gap, 10);
                const op = opIdsMap.find((opMap) => opMap.perfId === opData.id)?.opId;
                return {
                    ...opData,
                    high_dispatch: !!val && val > 6.5,
                    op,
                };
            }) || []
        );
    }, [comparisonData, opIdsMap]);

    const tableFields: PerfTableRow[] = useMemo(() => {
        let filteredRows = processedRows;

        if (areFiltersActive(filters) && filterableColumnKeys) {
            filteredRows = filteredRows.filter((row) => {
                const isFilteredOut =
                    filters &&
                    Object.entries(filters)
                        .filter(([_key, filterValue]) => String(filterValue).length)
                        .some(([key, filterValue]) => {
                            const bufferValue = getCellText(row, key as TableKeys);

                            return !bufferValue.toLowerCase().includes(filterValue.toLowerCase());
                        });

                return !isFilteredOut;
            });
        }

        if (activeFilters?.length > 0) {
            filteredRows = filteredRows.filter(
                (tensor) => tensor?.math_fidelity !== null && activeFilters.includes(tensor.math_fidelity),
            );
        }

        const parsedRows = filteredRows.map((row) => ({
            ...row,
            id: parseInt(row.id, 10),
            total_percent: parseFloat(row.total_percent),
            device_time: parseFloat(row.device_time),
            op_to_op_gap: row.op_to_op_gap ? parseFloat(row.op_to_op_gap) : null,
            cores: parseInt(row.cores, 10),
            dram: row.dram ? parseFloat(row.dram) : null,
            dram_percent: row.dram_percent ? parseFloat(row.dram_percent) : null,
            flops: row.flops ? parseFloat(row.flops) : null,
            flops_percent: row.flops_percent ? parseFloat(row.flops_percent) : null,
        })) as TypedPerfTableRow[];

        return sortTableFields(parsedRows);
    }, [processedRows, sortTableFields, filters, filterableColumnKeys, activeFilters]);

    const updateColumnFilter = (key: TableKeys, value: string) => {
        setFilters({
            ...filters,
            [key]: value ?? '',
        } as Record<TableKeys, string>);
    };

    return (
        <>
            <Switch
                className='expand-button'
                label={!mergeDeviceData ? 'Expanded device data' : 'Merged device data'}
                onChange={() => setMergeDeviceData(!mergeDeviceData)}
                checked={mergeDeviceData && isMultiDevice}
                disabled={!isMultiDevice}
            />

            <Switch
                className='expand-button'
                label={provideMatmulAdvice ? 'Hide Matmul optimization analysis' : 'Show Matmul optimization analysis'}
                onChange={() => setProvideMatmulAdvice(!provideMatmulAdvice)}
                checked={provideMatmulAdvice}
            />

            <Switch
                className='expand-button'
                label='Highlight high dispatch ops'
                onChange={() => setHiliteHighDispatch(!hiliteHighDispatch)}
                checked={hiliteHighDispatch}
            />

            <div className='perf-report'>
                <div className='table-header'>
                    <h3 className='title'>Performance report</h3>

                    <div className='header-aside'>
                        <p className='result-count'>
                            {tableFields.length !== data?.length
                                ? `Showing ${tableFields.length} of ${data?.length} rows`
                                : `Showing ${tableFields.length} rows`}
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

                    <Button
                        onClick={() => changeSorting(null)(null)}
                        variant={ButtonVariant.OUTLINED}
                        disabled={sortingColumn === null}
                    >
                        Reset sort
                    </Button>
                </div>

                <Tabs
                    selectedTabId={selectedTabId}
                    onChange={setSelectedTabId}
                    renderActiveTabPanelOnly
                    size={Size.LARGE}
                >
                    <Tab
                        id='perf-table-1'
                        title={activePerformanceReport}
                        icon={IconNames.TH_LIST}
                        panel={
                            <PerfTable
                                data={processedRows}
                                filters={filters}
                                provideMatmulAdvice={provideMatmulAdvice}
                                hiliteHighDispatch={hiliteHighDispatch}
                            />
                        }
                    />

                    {activeComparisonReport && processedComparisonRows?.length ? (
                        <Tab
                            id='perf-table-2'
                            title={activeComparisonReport}
                            icon={IconNames.TH_LIST}
                            panel={
                                <PerfTable
                                    data={processedComparisonRows}
                                    filters={filters}
                                    provideMatmulAdvice={provideMatmulAdvice}
                                    hiliteHighDispatch={hiliteHighDispatch}
                                />
                            }
                        />
                    ) : null}
                </Tabs>
            </div>
            <hr />
            {hiliteHighDispatch && calcHighDispatchOps(processedRows)}
        </>
    );
};

function areFiltersActive(filters: Record<TableKeys, string> | null) {
    return filters ? Object.values(filters).some((filter) => filter.length > 0) : false;
}

const getCellText = (buffer: PerfTableRow, key: TableKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

export default PerformanceReport;
