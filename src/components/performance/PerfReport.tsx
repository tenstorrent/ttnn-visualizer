// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { FC, useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
    Button,
    ButtonGroup,
    ButtonVariant,
    Callout,
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
import { FilterableColumnKeys, TableFilter, TableKeys, TypedPerfTableRow } from '../../definitions/PerfTable';
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
    mathFilterListAtom,
    rawOpCodeFilterListAtom,
    stackByIn0Atom,
} from '../../store/app';
import alignByOpCode from '../../functions/normalisePerformanceData';
import sortAndFilterPerfTableData from '../../functions/sortAndFilterPerfTableData';
import 'styles/components/PerfReport.scss';
import StackedPerformanceTable from './StackedPerfTable';
import {
    FilterableStackedColumnKeys,
    StackedTableFilter,
    StackedTableKeys,
    TypedStackedPerfRow,
} from '../../definitions/StackedPerfTable';
import sortAndFilterStackedPerfTableData from '../../functions/sortAndFilterStackedPerfTableData';
import HighlightedText from '../HighlightedText';
import PerfReportRowCount from './PerfReportRowCount';
import MultiSelectField from '../MultiSelectField';
import { BufferType, BufferTypeLabel } from '../../model/BufferType';
import { OpType } from '../../definitions/Performance';

interface PerformanceReportProps {
    data?: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    stackedData: TypedStackedPerfRow[];
    comparisonStackedData: TypedStackedPerfRow[][];
    signposts?: Signpost[];
}

const INITIAL_TAB_ID = 'perf-table-0'; // `perf-table-${index}`

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
    const [stackByIn0, setStackByIn0] = useAtom(stackByIn0Atom);
    const [filterBySignpost, setFilterBySignpost] = useAtom(filterBySignpostAtom);
    const [hideHostOps, setHideHostOps] = useAtom(hideHostOpsAtom);
    const [activeMathFilterList, setActiveMathFilterList] = useAtom(mathFilterListAtom);
    const [activeRawOpCodeFilterList, setActiveRawOpCodeFilterList] = useAtom(rawOpCodeFilterListAtom);
    const [activeBufferTypeFilterList, setActiveBufferTypeFilterList] = useAtom(bufferTypeFilterListAtom);

    // TODO: Reimplement merge/expand device data toggle
    // const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    // const [isMultiDevice, _setIsMultiDevice] = useState<boolean>(false);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState(false);
    const [selectedTabId, setSelectedTabId] = useState<TabId>(INITIAL_TAB_ID);
    const [useNormalisedData, setUseNormalisedData] = useState(true);
    const [highlightRows, setHighlightRows] = useState(true);
    const [filters, setFilters] = useState<TableFilter>(
        Object.fromEntries(FilterableColumnKeys.map((key) => [key, ''] as [TableKeys, string])) as Record<
            TableKeys,
            string
        >,
    );
    const [stackedFilters, setStackedFilters] = useState<StackedTableFilter>(
        Object.fromEntries(FilterableStackedColumnKeys.map((key) => [key, ''] as [StackedTableKeys, string])) as Record<
            StackedTableKeys,
            string
        >,
    );

    const isSignpostsDisabled = !signposts || signposts.length === 0;
    const comparisonIndex = (activeComparisonReportList ?? []).findIndex((value) => value === selectedTabId);

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

    const filteredRows = useMemo(
        () =>
            sortAndFilterPerfTableData(
                processedRows,
                filters,
                activeRawOpCodeFilterList,
                activeMathFilterList,
                activeBufferTypeFilterList,
                filterBySignpost,
            ),
        [
            processedRows,
            filters,
            activeMathFilterList,
            activeRawOpCodeFilterList,
            activeBufferTypeFilterList,
            filterBySignpost,
        ],
    );

    // TODO: Filters should apply to all comparison datasets, not just the selected one
    const filteredComparisonRows = useMemo(
        () =>
            sortAndFilterPerfTableData(
                processedComparisonRows[comparisonIndex],
                filters,
                activeRawOpCodeFilterList,
                activeMathFilterList,
                activeBufferTypeFilterList,
                filterBySignpost,
            ),
        [
            comparisonIndex,
            processedComparisonRows,
            filters,
            activeRawOpCodeFilterList,
            activeMathFilterList,
            activeBufferTypeFilterList,
            filterBySignpost,
        ],
    );

    const filteredStackedRows = useMemo(
        () => sortAndFilterStackedPerfTableData(stackedData, stackedFilters, activeRawOpCodeFilterList, stackByIn0),
        [stackedData, stackedFilters, activeRawOpCodeFilterList, stackByIn0],
    );

    const filteredComparisonStackedRows = useMemo(
        () =>
            sortAndFilterStackedPerfTableData(
                comparisonStackedData[comparisonIndex],
                stackedFilters,
                activeRawOpCodeFilterList,
                stackByIn0,
            ),
        [comparisonIndex, comparisonStackedData, stackedFilters, activeRawOpCodeFilterList, stackByIn0],
    );

    const updateColumnFilter = (key: TableKeys, value: string) => {
        const updatedFilters = {
            ...filters,
            [key]: value ?? '',
        };

        // TODO: Sort this madness out
        setStackedFilters(updatedFilters as Record<StackedTableKeys, string>);
        setFilters(updatedFilters as TableFilter);
    };

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
            isNormalisationApplied && processedComparisonRows?.[comparisonIndex]?.length === 0;

        if (isSelectedTabDisabled) {
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

                <div className='filters'>
                    <Switch
                        label='Hide host ops'
                        onChange={() => setHideHostOps(!hideHostOps)}
                        checked={hideHostOps}
                        className='option-switch'
                        // TODO: Host Ops are missing when stackByIn0 is disabled
                        disabled={!stackByIn0 && isStackedView}
                    />

                    <Select<Signpost>
                        items={signposts || []}
                        itemPredicate={filterSignpost}
                        itemRenderer={(item, itemProps) => renderSignpost(item, itemProps, filterBySignpost[0])}
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
                            text={
                                filterBySignpost[0]?.op_code ??
                                `Select start signpost... ${signposts && signposts?.length > 0 ? `(${signposts.length})` : ''}`
                            }
                            endIcon={IconNames.CARET_DOWN}
                            disabled={isSignpostsDisabled}
                        />
                    </Select>

                    <Select<Signpost>
                        items={
                            filterBySignpost[0]
                                ? signposts?.slice(signposts.findIndex((s) => s.id === filterBySignpost[0]?.id) + 1) ||
                                  []
                                : signposts || []
                        }
                        itemPredicate={filterSignpost}
                        itemRenderer={(item, itemProps) => renderSignpost(item, itemProps, filterBySignpost[1])}
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
                            text={
                                filterBySignpost[1]?.op_code ??
                                `Select end signpost... ${signposts && signposts?.length > 0 ? `(${signposts.length})` : ''}`
                            }
                            endIcon={IconNames.CARET_DOWN}
                            disabled={isSignpostsDisabled}
                        />
                    </Select>

                    <Button
                        variant={ButtonVariant.OUTLINED}
                        icon={IconNames.CROSS}
                        onClick={() => setFilterBySignpost((filter) => [null, filter[1]])}
                        disabled={isSignpostsDisabled}
                        aria-label={filterBySignpost ? `Remove signpost` : 'No signpost selected'}
                    />

                    <SearchField
                        onQueryChanged={(value) => updateColumnFilter('op_code', value)}
                        placeholder='Filter by operation name'
                        searchQuery={filters?.op_code || ''}
                    />

                    <MultiSelectField<TypedPerfTableRow, 'buffer_type'>
                        keyName='buffer_type'
                        options={processedRows || []}
                        labelFormatter={(value: BufferType | null) =>
                            value !== null ? BufferTypeLabel[value] : 'No value'
                        }
                        placeholder='Select Buffer Type...'
                        values={activeBufferTypeFilterList}
                        updateHandler={setActiveBufferTypeFilterList}
                    />

                    <MultiSelectField<TypedPerfTableRow, 'raw_op_code'>
                        keyName='raw_op_code'
                        options={getRawOpCodeOptions(processedRows) || []}
                        placeholder='Select Op Codes...'
                        values={activeRawOpCodeFilterList}
                        updateHandler={setActiveRawOpCodeFilterList}
                    />

                    <MultiSelectField<TypedPerfTableRow, 'math_fidelity'>
                        keyName='math_fidelity'
                        options={processedRows || []}
                        placeholder='Select Math Fidelity...'
                        values={activeMathFilterList}
                        updateHandler={setActiveMathFilterList}
                        disabled={isStackedView}
                    />
                </div>

                <div className='view-options'>
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
                </div>

                <div className='data-options'>
                    {!isStackedView && (
                        <>
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
                        </>
                    )}

                    {!isStackedView && (
                        <>
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

                            {activeComparisonReportList && useNormalisedData && (
                                <Tooltip
                                    content='Highlights rows where ops have been added or are missing after normalising the data'
                                    position={Position.TOP}
                                >
                                    <Switch
                                        label='Highlight row differences'
                                        onChange={() => setHighlightRows(!highlightRows)}
                                        disabled={!activeComparisonReportList || !useNormalisedData || isStackedView}
                                        checked={highlightRows}
                                        className='option-switch'
                                    />
                                </Tooltip>
                            )}
                        </>
                    )}

                    {isStackedView && (
                        <Switch
                            label='Stack by input 0'
                            onChange={() => setStackByIn0(!stackByIn0)}
                            checked={stackByIn0}
                            className='option-switch'
                            disabled={!isStackedView}
                        />
                    )}
                </div>

                <Callout
                    className='multi-device-note'
                    intent={Intent.PRIMARY}
                    icon={IconNames.INFO_SIGN}
                    compact
                >
                    Multi device operations are merged into single rows using <u>average duration</u> for collective
                    operations (AllGather, ReduceScatter, AllReduce) and <u>maximum duration</u> for all others.
                </Callout>

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
                                    stackedComparisonData={comparisonStackedData}
                                    reportName={activePerformanceReport?.reportName || null}
                                />
                            ) : (
                                <PerfTable
                                    data={filteredRows}
                                    comparisonData={processedComparisonRows}
                                    filters={filters}
                                    provideMatmulAdvice={provideMatmulAdvice}
                                    hiliteHighDispatch={hiliteHighDispatch}
                                    shouldHighlightRows={highlightRows && useNormalisedData}
                                    reportName={activePerformanceReport?.reportName || null}
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
                                            comparisonIndex > -1
                                                ? sortAndFilterStackedPerfTableData(
                                                      comparisonStackedData[comparisonIndex],
                                                      stackedFilters,
                                                      activeRawOpCodeFilterList,
                                                      stackByIn0,
                                                  )
                                                : filteredStackedRows
                                        }
                                        stackedComparisonData={[
                                            stackedData,
                                            ...comparisonStackedData.filter((_, i) => i !== comparisonIndex),
                                        ].map((dataset) =>
                                            sortAndFilterStackedPerfTableData(
                                                dataset,
                                                stackedFilters,
                                                activeRawOpCodeFilterList,
                                                stackByIn0,
                                            ),
                                        )}
                                        filters={filters}
                                        reportName={report}
                                    />
                                ) : (
                                    <PerfTable
                                        data={filteredComparisonRows}
                                        comparisonData={[
                                            processedRows,
                                            ...processedComparisonRows.filter((_, i) => i !== comparisonIndex),
                                        ]}
                                        filters={filters}
                                        provideMatmulAdvice={provideMatmulAdvice}
                                        hiliteHighDispatch={hiliteHighDispatch}
                                        shouldHighlightRows={highlightRows && useNormalisedData}
                                        reportName={report}
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
    (item: T, itemProps: ItemRendererProps, selectedItem: T | null): React.JSX.Element | null;
}

const renderSignpost: RenderSignpostProps<Signpost> = (
    signpost,
    { handleClick, handleFocus, modifiers, query },
    activeSignpost,
) => {
    if (!modifiers.matchesPredicate) {
        return null;
    }

    return (
        <MenuItem
            active={signpost.id === activeSignpost?.id}
            disabled={modifiers.disabled}
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

export default PerformanceReport;
