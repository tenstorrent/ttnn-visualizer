// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { FC, useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
    Button,
    ButtonGroup,
    ButtonVariant,
    FormGroup,
    Intent,
    MenuItem,
    PopoverPosition,
    Position,
    Size,
    Switch,
    Tab,
    TabId,
    Tabs,
    Tooltip,
} from '@blueprintjs/core';
import { ItemPredicate, ItemRendererProps, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import { ColumnKeys, Columns, TypedPerfTableRow } from '../../definitions/PerfTable';
import { Signpost, calcHighDispatchOps } from '../../functions/perfFunctions';
import SearchField from '../SearchField';
import PerfTable from './PerfTable';
import {
    activePerformanceReportAtom,
    bufferTypeFilterListAtom,
    comparisonPerformanceReportListAtom,
    filterBySignpostAtom,
    hideHostOpsAtom,
    isStackedViewAtom,
    layoutFilterListAtom,
    mathFilterListAtom,
    mergeDevicesAtom,
    rawOpCodeFilterListAtom,
    stackedGroupByAtom,
    tracingModeAtom,
} from '../../store/app';
import alignByOpCode from '../../functions/normalisePerformanceData';
import sortAndFilterPerfTableData from '../../functions/sortAndFilterPerfTableData';
import 'styles/components/PerfReport.scss';
import StackedPerformanceTable from './StackedPerfTable';
import {
    StackedColumnKeys,
    StackedGroupBy,
    StackedTableFilter,
    TypedStackedPerfRow,
    filterableStackedColumnKeys,
} from '../../definitions/StackedPerfTable';
import sortAndFilterStackedPerfTableData from '../../functions/sortAndFilterStackedPerfTableData';
import HighlightedText from '../HighlightedText';
import PerfReportRowCount from './PerfReportRowCount';
import MultiSelectField from '../MultiSelectField';
import { BufferType, BufferTypeLabel } from '../../model/BufferType';
import { OpType } from '../../definitions/Performance';
import { capitalizeString } from '../../functions/formatting';
import { DeviceOperationLayoutTypes } from '../../model/APIData';

enum SignpostSelectType {
    START,
    END,
}

interface PerformanceReportProps {
    data?: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    stackedData: TypedStackedPerfRow[];
    comparisonStackedData: TypedStackedPerfRow[][];
    signposts?: Signpost[];
}

const INITIAL_TAB_ID = 'perf-table-0'; // `perf-table-${index}`
const STACKED_GROUP_BY = [StackedGroupBy.CATEGORY, StackedGroupBy.MEMORY, StackedGroupBy.OP];

const PerformanceReport: FC<PerformanceReportProps> = ({
    data,
    comparisonData,
    stackedData,
    comparisonStackedData,
    signposts,
}) => {
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const activeComparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);
    const [isStackedView, setIsStackedView] = useAtom(isStackedViewAtom);
    const [filterBySignpost, setFilterBySignpost] = useAtom(filterBySignpostAtom);
    const [hideHostOps, setHideHostOps] = useAtom(hideHostOpsAtom);
    const [mergeDevices, setMergeDevices] = useAtom(mergeDevicesAtom);
    const [tracingMode, setTracingMode] = useAtom(tracingModeAtom);
    const [stackedGroupBy, setStackedGroupBy] = useAtom(stackedGroupByAtom);
    const [activeMathFilterList, setActiveMathFilterList] = useAtom(mathFilterListAtom);
    const [activeRawOpCodeFilterList, setActiveRawOpCodeFilterList] = useAtom(rawOpCodeFilterListAtom);
    const [activeBufferTypeFilterList, setActiveBufferTypeFilterList] = useAtom(bufferTypeFilterListAtom);
    const [activeLayoutFilterList, setActiveLayoutFilterList] = useAtom(layoutFilterListAtom);

    // TODO: Reimplement merge/expand device data toggle
    // const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    // const [isMultiDevice, _setIsMultiDevice] = useState<boolean>(false);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState(false);
    const [selectedTabId, setSelectedTabId] = useState<TabId>(INITIAL_TAB_ID);
    const [useNormalisedData, setUseNormalisedData] = useState(true);
    // const [showHashColumn, setShowHashColumn] = useState(false);
    const filterableColumnKeys = useMemo(
        () => Columns.filter((column) => column.filterable).map((column) => column.key),
        [],
    );

    const [filters, setFilters] = useState(
        Object.fromEntries(filterableColumnKeys.map((key) => [key, ''] as [ColumnKeys, string])) as Record<
            ColumnKeys,
            string
        >,
    );
    const [stackedFilters, setStackedFilters] = useState<StackedTableFilter>(
        Object.fromEntries(filterableStackedColumnKeys.map((key) => [key, ''])) as StackedTableFilter,
    );

    const isSignpostsDisabled = !signposts || signposts.length === 0;
    const comparisonIndex = (activeComparisonReportList ?? []).findIndex((value) => value === selectedTabId);
    const isGroupedByMemory = stackedGroupBy === StackedGroupBy.MEMORY;
    const filterScopeHelperText =
        activeComparisonReportList?.length &&
        'Comparison rows may not be filtered in order to maintain row data alignment';

    const {
        data: [processedRows, ...processedComparisonRows],
    } = useMemo(() => {
        const rows = data || [];
        const compRows = comparisonData?.map((dataset) => dataset || []) || [];

        if (useNormalisedData && rows.length > 0 && compRows.length > 0) {
            return alignByOpCode(rows, compRows);
        }

        return { data: [rows, ...compRows], missingRows: [] };
    }, [data, comparisonData, useNormalisedData]);

    const isNormalisationApplied = !isStackedView && useNormalisedData;
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
        () => activeRawOpCodeFilterList.filter((value) => availableRawOpCodeOptionSet.has(value)),
        [activeRawOpCodeFilterList, availableRawOpCodeOptionSet],
    );

    const { filteredRows, filteredComparisonRowsList } = useMemo(() => {
        if (!isNormalisationApplied) {
            const opCodeFilterValue = filters[ColumnKeys.OpCode]?.toLowerCase() || '';
            const hasOpCodeTextFilter = opCodeFilterValue.length > 0;
            const hasRawOpCodeFilter = effectiveRawOpCodeFilterList.length > 0;
            const hasOpFilters = hasOpCodeTextFilter || hasRawOpCodeFilter;
            const filtersWithoutOpCode = {
                ...filters,
                [ColumnKeys.OpCode]: '',
            };
            const allDatasets = [processedRows, ...processedComparisonRows];
            const datasetsWithoutOpFilters = allDatasets.map((dataset) =>
                sortAndFilterPerfTableData(dataset, {
                    filters: filtersWithoutOpCode,
                    mathFilter: activeMathFilterList,
                    bufferTypeFilter: activeBufferTypeFilterList,
                    activeLayoutFilterList,
                }),
            );
            const datasetRowSets = datasetsWithoutOpFilters.map((dataset) => new Set(dataset));

            if (!hasOpFilters) {
                const [filteredSourceRows, ...filteredComparisonRows] = datasetsWithoutOpFilters.map((dataset) =>
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

                return alignedRows.some((alignedRow) => {
                    const matchesOpCodeText = hasOpCodeTextFilter
                        ? alignedRow.op_code.toLowerCase().includes(opCodeFilterValue)
                        : true;
                    const matchesRawOpCode = hasRawOpCodeFilter
                        ? alignedRow.raw_op_code !== null &&
                          effectiveRawOpCodeFilterList.includes(alignedRow.raw_op_code)
                        : true;

                    return matchesOpCodeText && matchesRawOpCode;
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

        const opCodeFilterValue = filters[ColumnKeys.OpCode]?.toLowerCase() || '';
        const hasOpCodeTextFilter = opCodeFilterValue.length > 0;
        const hasRawOpCodeFilter = effectiveRawOpCodeFilterList.length > 0;
        const hasOpFilters = hasOpCodeTextFilter || hasRawOpCodeFilter;
        const filtersWithoutOpCode = {
            ...filters,
            [ColumnKeys.OpCode]: '',
        };
        const sourceRowsWithoutSignposts = sortAndFilterPerfTableData(processedRows, {
            filters: filtersWithoutOpCode,
            mathFilter: activeMathFilterList,
            bufferTypeFilter: activeBufferTypeFilterList,
            activeLayoutFilterList,
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
        activeMathFilterList,
        effectiveRawOpCodeFilterList,
        activeBufferTypeFilterList,
        activeLayoutFilterList,
        filterBySignpost,
        processedComparisonRows,
    ]);
    const filteredComparisonRows = useMemo(
        () => filteredComparisonRowsList[comparisonIndex] || [],
        [filteredComparisonRowsList, comparisonIndex],
    );

    const filteredStackedRows = useMemo(
        () =>
            sortAndFilterStackedPerfTableData(
                stackedData,
                stackedFilters,
                effectiveRawOpCodeFilterList,
                isGroupedByMemory,
            ),
        [stackedData, stackedFilters, effectiveRawOpCodeFilterList, isGroupedByMemory],
    );

    const filteredComparisonStackedRowsList = useMemo(
        () =>
            comparisonStackedData.map((dataset) =>
                sortAndFilterStackedPerfTableData(
                    dataset,
                    stackedFilters,
                    effectiveRawOpCodeFilterList,
                    isGroupedByMemory,
                ),
            ),
        [comparisonStackedData, stackedFilters, effectiveRawOpCodeFilterList, isGroupedByMemory],
    );
    const filteredComparisonStackedRows = useMemo(
        () => filteredComparisonStackedRowsList[comparisonIndex] || [],
        [filteredComparisonStackedRowsList, comparisonIndex],
    );

    const updateColumnFilter = (_key: ColumnKeys.OpCode | StackedColumnKeys.OpCode, value: string) => {
        // Only OpCode filter is shared between standard and stacked views
        setFilters((prevFilters) => ({
            ...prevFilters,
            [ColumnKeys.OpCode]: value ?? '',
        }));

        setStackedFilters((prevStackedFilters) => ({
            ...prevStackedFilters,
            [StackedColumnKeys.OpCode]: value ?? '',
        }));
    };

    // Resets various state if we remove all comparison reports
    useEffect(() => {
        if (!activeComparisonReportList?.includes(selectedTabId as string) && selectedTabId !== INITIAL_TAB_ID) {
            // Has sufficient guard conditions
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedTabId(INITIAL_TAB_ID);
        }

        if (!activeComparisonReportList) {
            setUseNormalisedData(false);
        }
    }, [activeComparisonReportList, selectedTabId]);

    // If currently selected tab is disabled, reset to initial tab
    useEffect(() => {
        const isSelectedTabDisabled =
            isNormalisationApplied && processedComparisonRows?.[comparisonIndex]?.length === 0;

        if (isSelectedTabDisabled) {
            // Has sufficient guard conditions
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedTabId(INITIAL_TAB_ID);
        }
    }, [selectedTabId, processedComparisonRows, comparisonIndex, isNormalisationApplied]);

    const isInitialTab = selectedTabId === INITIAL_TAB_ID;

    const activeDataCount = useMemo(() => {
        const isComparison = !isInitialTab;
        let filteredData;
        let processedData;

        if (isComparison) {
            filteredData = isStackedView ? filteredComparisonStackedRows : filteredComparisonRows;
            processedData = isStackedView
                ? comparisonStackedData[comparisonIndex]
                : processedComparisonRows[comparisonIndex];
        } else {
            filteredData = isStackedView ? filteredStackedRows : filteredRows;
            processedData = isStackedView ? stackedData : processedRows;
        }

        const delta = isComparison
            ? (processedComparisonRows[comparisonIndex]?.length ?? 0) - (comparisonData?.[comparisonIndex]?.length ?? 0)
            : 0;

        return { filtered: filteredData?.length, total: processedData?.length, delta };
    }, [
        isInitialTab,
        comparisonIndex,
        isStackedView,
        filteredRows,
        processedRows,
        filteredStackedRows,
        comparisonData,
        stackedData,
        comparisonStackedData,
        filteredComparisonRows,
        processedComparisonRows,
        filteredComparisonStackedRows,
    ]);

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
                <div className='report-header'>
                    <h3 className='title'>Performance report</h3>

                    <div className='header-aside'>
                        <p className='result-count'>
                            {data && data.length ? (
                                <PerfReportRowCount
                                    delta={isInitialTab ? 0 : activeDataCount.delta}
                                    filteredCount={activeDataCount.filtered}
                                    total={activeDataCount.total}
                                    useNormalisedData={useNormalisedData}
                                />
                            ) : null}
                        </p>
                    </div>
                </div>

                <ButtonGroup
                    variant={ButtonVariant.OUTLINED}
                    size={Size.SMALL}
                >
                    <Button
                        text='Standard'
                        icon={IconNames.LIST}
                        active={!isStackedView}
                        onClick={() => setIsStackedView(false)}
                        intent={!isStackedView ? Intent.PRIMARY : Intent.NONE}
                    />
                    <Button
                        text='Stacked'
                        icon={IconNames.LAYOUT_TWO_ROWS}
                        active={isStackedView}
                        onClick={() => setIsStackedView(true)}
                        intent={isStackedView ? Intent.PRIMARY : Intent.NONE}
                    />
                </ButtonGroup>

                <div className='option-row'>
                    <FormGroup
                        subLabel='Input data options'
                        className='form-group'
                    >
                        <ButtonGroup className='select-group'>
                            <Select<Signpost>
                                items={signposts || []}
                                itemPredicate={filterSignpost}
                                itemRenderer={(item, itemProps) =>
                                    renderSignpost(
                                        item,
                                        itemProps,
                                        filterBySignpost,
                                        signposts || [],
                                        SignpostSelectType.START,
                                    )
                                }
                                onItemSelect={(value) => setFilterBySignpost((filter) => [value, filter[1]])}
                                noResults={
                                    <MenuItem
                                        text='No signposts found'
                                        roleStructure='listoption'
                                    />
                                }
                                disabled={isSignpostsDisabled}
                                filterable
                            >
                                <Button
                                    text={filterBySignpost[0]?.op_code ?? `Start signpost...`}
                                    endIcon={IconNames.CARET_DOWN}
                                    disabled={isSignpostsDisabled}
                                />
                            </Select>

                            <Button
                                icon={IconNames.CROSS}
                                onClick={() => setFilterBySignpost((filter) => [null, filter[1]])}
                                disabled={isSignpostsDisabled}
                                aria-label={
                                    filterBySignpost[0] ? `Remove start signpost` : 'No start signpost selected'
                                }
                            />
                        </ButtonGroup>

                        <ButtonGroup className='select-group'>
                            <Select<Signpost>
                                items={signposts || []}
                                itemPredicate={filterSignpost}
                                itemRenderer={(item, itemProps) =>
                                    renderSignpost(
                                        item,
                                        itemProps,
                                        filterBySignpost,
                                        signposts || [],
                                        SignpostSelectType.END,
                                    )
                                }
                                onItemSelect={(value) => setFilterBySignpost((filter) => [filter[0], value])}
                                noResults={
                                    <MenuItem
                                        text='No signposts found'
                                        roleStructure='listoption'
                                    />
                                }
                                disabled={isSignpostsDisabled}
                                filterable
                            >
                                <Button
                                    text={filterBySignpost[1]?.op_code ?? `End signpost...`}
                                    endIcon={IconNames.CARET_DOWN}
                                    disabled={isSignpostsDisabled}
                                />
                            </Select>

                            <Button
                                icon={IconNames.CROSS}
                                onClick={() => setFilterBySignpost((filter) => [filter[0], null])}
                                disabled={isSignpostsDisabled}
                                aria-label={filterBySignpost[1] ? `Remove end signpost` : 'No end signpost selected'}
                            />
                        </ButtonGroup>

                        <ButtonGroup className='switch-group'>
                            <Switch
                                label='Hide host ops'
                                onChange={() => setHideHostOps(!hideHostOps)}
                                checked={hideHostOps}
                                className='option-switch'
                                // Host Ops are missing when not grouped by memory is disabled - https://github.com/tenstorrent/ttnn-visualizer/issues/1268
                                disabled={!isGroupedByMemory && isStackedView}
                            />

                            <Switch
                                label='Merge device rows'
                                onChange={() => setMergeDevices(!mergeDevices)}
                                checked={mergeDevices}
                                className='option-switch'
                            />

                            <Tooltip
                                content='Tracing mode will skip sorting operations based on execution order'
                                position={PopoverPosition.TOP}
                            >
                                <Switch
                                    label='Tracing mode'
                                    onChange={() => setTracingMode(!tracingMode)}
                                    checked={tracingMode}
                                    className='option-switch'
                                />
                            </Tooltip>
                        </ButtonGroup>
                    </FormGroup>
                    {isStackedView && (
                        <FormGroup
                            subLabel='Stacked data grouping'
                            className='form-group'
                        >
                            <ButtonGroup className='select-group'>
                                <Select<StackedGroupBy>
                                    activeItem={stackedGroupBy}
                                    items={STACKED_GROUP_BY}
                                    itemRenderer={(item, itemProps) => renderStackedGroupBy(item, itemProps)}
                                    onItemSelect={(value) => setStackedGroupBy(value)}
                                >
                                    <Button
                                        text={capitalizeString(stackedGroupBy)}
                                        endIcon={IconNames.CARET_DOWN}
                                    />
                                </Select>
                            </ButtonGroup>
                        </FormGroup>
                    )}
                </div>

                <div className='filters-container'>
                    <FormGroup
                        subLabel='Filters'
                        helperText={filterScopeHelperText}
                        className='form-group option-row'
                    >
                        <ButtonGroup className='select-group'>
                            <SearchField
                                onQueryChanged={(value) => updateColumnFilter(ColumnKeys.OpCode, value)}
                                placeholder='Filter by operation name'
                                searchQuery={filters?.op_code || ''}
                            />

                            <MultiSelectField<TypedPerfTableRow, 'raw_op_code'>
                                keyName='raw_op_code'
                                options={rawOpCodeOptions}
                                placeholder='Select Op Codes...'
                                values={activeRawOpCodeFilterList}
                                updateHandler={setActiveRawOpCodeFilterList}
                            />
                        </ButtonGroup>
                    </FormGroup>

                    {!isStackedView && (
                        <FormGroup className='option-row'>
                            <ButtonGroup className='select-group'>
                                <MultiSelectField<TypedPerfTableRow, 'buffer_type'>
                                    keyName='buffer_type'
                                    options={combinedRows}
                                    labelFormatter={(value: BufferType | null) =>
                                        value !== null ? BufferTypeLabel[value] : 'No value'
                                    }
                                    placeholder='Select Buffer Type...'
                                    values={activeBufferTypeFilterList}
                                    updateHandler={setActiveBufferTypeFilterList}
                                />

                                <MultiSelectField<TypedPerfTableRow, 'layout'>
                                    keyName='layout'
                                    options={combinedRows}
                                    labelFormatter={(value: DeviceOperationLayoutTypes | null) =>
                                        value !== null ? value : 'No value'
                                    }
                                    placeholder='Select Layout...'
                                    values={activeLayoutFilterList}
                                    updateHandler={setActiveLayoutFilterList}
                                />

                                <MultiSelectField<TypedPerfTableRow, 'math_fidelity'>
                                    keyName='math_fidelity'
                                    options={combinedRows}
                                    placeholder='Select Math Fidelity...'
                                    values={activeMathFilterList}
                                    updateHandler={setActiveMathFilterList}
                                    disabled={isStackedView}
                                />
                            </ButtonGroup>

                            <ButtonGroup className='switch-group'>
                                <Switch
                                    label='Matmul optimization analysis'
                                    onChange={() => setProvideMatmulAdvice(!provideMatmulAdvice)}
                                    checked={provideMatmulAdvice}
                                    className='option-switch'
                                    disabled={isStackedView}
                                />

                                <Switch
                                    label='Highlight high dispatch ops'
                                    onChange={() => setHiliteHighDispatch(!hiliteHighDispatch)}
                                    checked={hiliteHighDispatch}
                                    className='option-switch'
                                    disabled={isStackedView}
                                />

                                <Tooltip
                                    content='Tries to match up operations between the performance reports'
                                    position={Position.TOP}
                                >
                                    <Switch
                                        label='Normalise data'
                                        disabled={!activeComparisonReportList || isStackedView}
                                        onChange={() => setUseNormalisedData(!useNormalisedData)}
                                        checked={useNormalisedData}
                                        className='option-switch'
                                    />
                                </Tooltip>
                            </ButtonGroup>
                        </FormGroup>
                    )}

                    {/* May keep this or remove it - undecided as yet */}
                    {/* <Switch
                        label='Show Hash Column'
                        onChange={() => setShowHashColumn(!showHashColumn)}
                        checked={showHashColumn}
                        className='option-switch'
                    /> */}
                </div>

                <Tabs
                    selectedTabId={selectedTabId}
                    onChange={setSelectedTabId}
                    renderActiveTabPanelOnly
                    size={Size.LARGE}
                    id='performance-tabs'
                    className='report-tabs'
                >
                    <Tab
                        id={INITIAL_TAB_ID}
                        title={activePerformanceReport?.reportName || 'Loading...'}
                        icon={IconNames.TH_LIST}
                        panel={
                            isStackedView ? (
                                <StackedPerformanceTable
                                    data={filteredRows}
                                    stackedData={filteredStackedRows}
                                    filters={filters}
                                    stackedComparisonData={filteredComparisonStackedRowsList}
                                    reportName={activePerformanceReport?.reportName || null}
                                />
                            ) : (
                                <PerfTable
                                    data={filteredRows}
                                    comparisonData={filteredComparisonRowsList}
                                    filters={filters}
                                    provideMatmulAdvice={provideMatmulAdvice}
                                    hiliteHighDispatch={hiliteHighDispatch}
                                    reportName={activePerformanceReport?.reportName || null}
                                    showHashColumn={false}
                                />
                            )
                        }
                    />

                    {activeComparisonReportList?.map((report, index) => (
                        <Tab
                            id={report}
                            key={index}
                            icon={IconNames.TH_LIST}
                            disabled={isNormalisationApplied && processedComparisonRows?.[index]?.length === 0}
                            title={
                                isNormalisationApplied && processedComparisonRows?.[index]?.length === 0 ? (
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
                                isStackedView ? (
                                    <StackedPerformanceTable
                                        data={filteredRows}
                                        stackedData={
                                            comparisonIndex > -1 ? filteredComparisonStackedRows : filteredStackedRows
                                        }
                                        stackedComparisonData={[
                                            filteredStackedRows,
                                            ...filteredComparisonStackedRowsList.filter(
                                                (_, i) => i !== comparisonIndex,
                                            ),
                                        ]}
                                        filters={filters}
                                        reportName={report}
                                    />
                                ) : (
                                    <PerfTable
                                        data={filteredComparisonRows}
                                        comparisonData={[
                                            filteredRows,
                                            ...filteredComparisonRowsList.filter((_, i) => i !== comparisonIndex),
                                        ]}
                                        filters={filters}
                                        provideMatmulAdvice={provideMatmulAdvice}
                                        hiliteHighDispatch={hiliteHighDispatch}
                                        reportName={report}
                                        showHashColumn={false}
                                    />
                                )
                            }
                        />
                    ))}
                </Tabs>

                {hiliteHighDispatch && !isStackedView && calcHighDispatchOps(processedRows)}
            </div>
        </>
    );
};

interface RenderSignpostProps<T> {
    (
        item: T,
        itemProps: ItemRendererProps,
        selectedSignposts: (T | null)[],
        allSignposts: T[],
        selectType: SignpostSelectType,
    ): React.JSX.Element | null;
}

const renderSignpost: RenderSignpostProps<Signpost> = (
    signpost,
    { handleClick, handleFocus, modifiers, query },
    selectedSignposts,
    allSignposts,
    selectType,
) => {
    if (!modifiers.matchesPredicate) {
        return null;
    }

    // Check if the current signpost should be disabled based on selectType and filterBySignpost
    let isOutsideRange = false;
    const [startSignpost, endSignpost] = selectedSignposts;
    const currentIndex = allSignposts.findIndex((s) => s.id === signpost.id);

    if (selectType === SignpostSelectType.START) {
        // For start select: only disable items after the end signpost
        if (endSignpost) {
            const endIndex = allSignposts.findIndex((s) => s.id === endSignpost.id) - 1;
            if (endIndex !== -1) {
                isOutsideRange = currentIndex > endIndex;
            }
        }
    } else if (selectType === SignpostSelectType.END) {
        // For end select: only disable items before the start signpost
        if (startSignpost) {
            const startIndex = allSignposts.findIndex((s) => s.id === startSignpost.id) + 1;
            if (startIndex !== -1) {
                isOutsideRange = currentIndex < startIndex;
            }
        }
    }

    return (
        <MenuItem
            active={modifiers.active}
            disabled={modifiers.disabled || isOutsideRange}
            key={signpost.id}
            onClick={handleClick}
            onFocus={handleFocus}
            roleStructure='listoption'
            text={
                <HighlightedText
                    text={`${signpost.id}. ${signpost.op_code}`}
                    filter={query}
                />
            }
        />
    );
};

const filterSignpost: ItemPredicate<Signpost> = (query, signpost) => {
    return signpost.op_code.toLowerCase().includes(query.toLowerCase());
};

const getRawOpCodeOptions = (rows: TypedPerfTableRow[]): TypedPerfTableRow[] => {
    // Don't want signposts here
    const options = rows.filter((row) => row.op_type !== OpType.SIGNPOST);

    return Array.from(new Set(options));
};

interface RenderStackedGroupByProps<T> {
    (item: T, itemProps: ItemRendererProps): React.JSX.Element | null;
}

const renderStackedGroupBy: RenderStackedGroupByProps<StackedGroupBy> = (
    value,
    { handleClick, handleFocus, modifiers, query, id },
) => {
    if (!modifiers.matchesPredicate) {
        return null;
    }

    return (
        <MenuItem
            active={modifiers.active}
            disabled={modifiers.disabled}
            key={id}
            onClick={handleClick}
            onFocus={handleFocus}
            roleStructure='listoption'
            text={
                <HighlightedText
                    text={capitalizeString(value)}
                    filter={query}
                />
            }
        />
    );
};

export default PerformanceReport;
