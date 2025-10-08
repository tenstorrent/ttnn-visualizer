// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
    Button,
    ButtonGroup,
    ButtonVariant,
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
import { ItemPredicate, ItemRenderer, Select } from '@blueprintjs/select';
import { IconNames } from '@blueprintjs/icons';
import {
    FilterableColumnKeys,
    PerfTableRow,
    TableFilter,
    TableKeys,
    TypedPerfTableRow,
} from '../../definitions/PerfTable';
import { useOpToPerfIdFiltered } from '../../hooks/useAPI';
import {
    Signpost,
    calcHighDispatchOps,
    getStackedViewCounts,
    getStandardViewCounts,
} from '../../functions/perfFunctions';
import SearchField from '../SearchField';
import PerfTable from './PerfTable';
import {
    activePerformanceReportAtom,
    comparisonPerformanceReportListAtom,
    filterBySignpostAtom,
    hideHostOpsAtom,
    isStackedViewAtom,
    mathFilterAtom,
    rawOpCodeFilterAtom,
    stackByIn0Atom,
} from '../../store/app';
import alignByOpCode from '../../functions/normalisePerformanceData';
import sortAndFilterPerfTableData from '../../functions/sortAndFilterPerfTableData';
import 'styles/components/PerfReport.scss';
import StackedPerformanceTable from './StackedPerfTable';
import {
    FilterableStackedColumnKeys,
    StackedPerfRow,
    StackedTableFilter,
    StackedTableKeys,
    TypedStackedPerfRow,
} from '../../definitions/StackedPerfTable';
import sortAndFilterStackedPerfTableData from '../../functions/sortAndFilterStackedPerfTableData';
import HighlightedText from '../HighlightedText';
import { OpType } from '../../definitions/Performance';
import PerfReportRowCount from './PerfReportRowCount';
import MultiSelectField from '../MultiSelectField';

interface PerformanceReportProps {
    data?: PerfTableRow[];
    comparisonData?: PerfTableRow[][];
    stackedData?: StackedPerfRow[];
    comparisonStackedData?: StackedPerfRow[][];
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
    const [activeMathFilter, setActiveMathFilter] = useAtom(mathFilterAtom);
    const [activeRawOpCodeFilter, setActiveRawOpCodeFilter] = useAtom(rawOpCodeFilterAtom);

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

    const opIdsMap = useOpToPerfIdFiltered();

    const isSignpostsDisabled = !signposts || signposts.length === 0;

    const comparisonIndex = (activeComparisonReportList ?? []).findIndex((value) => value === selectedTabId);

    const processedRows: TypedPerfTableRow[] = useMemo(() => {
        return data ? enrichRowData(data, opIdsMap) : [];
    }, [data, opIdsMap]);

    const processedComparisonRows: TypedPerfTableRow[][] = useMemo(() => {
        return comparisonData?.map((dataset) => enrichRowData(dataset, opIdsMap)) || [];
    }, [comparisonData, opIdsMap]);

    const processedStackedRows: TypedStackedPerfRow[] = useMemo(() => {
        return stackedData ? enrichStackedRowData(stackedData) : [];
    }, [stackedData]);

    const processedComparisonStackedRows: TypedStackedPerfRow[][] = useMemo(() => {
        return comparisonStackedData?.map(enrichStackedRowData) || [];
    }, [comparisonStackedData]);

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
                activeRawOpCodeFilter,
                activeMathFilter,
                hideHostOps,
            ),
        [
            processedRows,
            filters,
            activeMathFilter,
            activeRawOpCodeFilter,
            useNormalisedData,
            normalisedData.data,
            hideHostOps,
        ],
    );

    const filteredComparisonRows = useMemo(
        () =>
            sortAndFilterPerfTableData(
                useNormalisedData ? normalisedData.data[comparisonIndex] : processedComparisonRows[comparisonIndex],
                filters,
                activeRawOpCodeFilter,
                activeMathFilter,
                hideHostOps,
            ),
        [
            comparisonIndex,
            processedComparisonRows,
            filters,
            activeRawOpCodeFilter,
            activeMathFilter,
            useNormalisedData,
            normalisedData.data,
            hideHostOps,
        ],
    );

    const filteredStackedRows = useMemo(
        () =>
            sortAndFilterStackedPerfTableData(processedStackedRows, stackedFilters, activeRawOpCodeFilter, hideHostOps),
        [processedStackedRows, stackedFilters, activeRawOpCodeFilter, hideHostOps],
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
                <div className='report-header'>
                    <h3 className='title'>Performance report</h3>

                    <div className='header-aside'>
                        <p className='result-count'>
                            <PerfReportRowCount
                                standardView={getStandardViewCounts(
                                    processedRows,
                                    filteredRows,
                                    selectedTabId === INITIAL_TAB_ID,
                                    processedComparisonRows,
                                    filteredComparisonRows,
                                    useNormalisedData ? normalisedData : null,
                                    comparisonIndex,
                                    comparisonData,
                                )}
                                stackedView={getStackedViewCounts(processedStackedRows, filteredStackedRows)}
                                useNormalisedData={useNormalisedData}
                            />
                        </p>
                    </div>
                </div>

                <div className='filters'>
                    <SearchField
                        onQueryChanged={(value) => updateColumnFilter('op_code', value)}
                        placeholder='Filter by operation name'
                        searchQuery={filters?.op_code || ''}
                    />

                    <MultiSelectField<PerfTableRow, 'raw_op_code'>
                        keyName='raw_op_code'
                        options={data || []}
                        placeholder='Select Op Codes...'
                        values={activeRawOpCodeFilter}
                        updateHandler={setActiveRawOpCodeFilter}
                    />

                    <MultiSelectField<PerfTableRow, 'math_fidelity'>
                        keyName='math_fidelity'
                        options={data || []}
                        placeholder='Select Math Fidelity...'
                        values={activeMathFilter}
                        updateHandler={setActiveMathFilter}
                    />

                    <Select<Signpost>
                        items={signposts || []}
                        itemPredicate={filterSignpost}
                        itemRenderer={renderSignpost}
                        onItemSelect={setFilterBySignpost}
                        noResults={
                            <MenuItem
                                text='No signposts found'
                                roleStructure='listoption'
                            />
                        }
                        filterable
                        disabled={isSignpostsDisabled}
                    >
                        <Button
                            text={
                                filterBySignpost?.op_code ??
                                `Select signpost... ${signposts && signposts?.length > 0 ? `(${signposts.length})` : ''}`
                            }
                            endIcon={IconNames.CARET_DOWN}
                            disabled={isSignpostsDisabled}
                        />
                    </Select>

                    <Button
                        variant={ButtonVariant.OUTLINED}
                        icon={IconNames.CROSS}
                        onClick={() => setFilterBySignpost(null)}
                        disabled={isSignpostsDisabled}
                        aria-label={filterBySignpost ? `Remove signpost` : 'No signpost selected'}
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

                    <Switch
                        label='Hide host ops'
                        onChange={() => setHideHostOps(!hideHostOps)}
                        checked={hideHostOps}
                        className='option-switch'
                        // TODO: Host Ops don't get sent in non-stacked-by-in0
                        disabled={!stackByIn0}
                    />

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
                        title={activePerformanceReport || 'Loading...'}
                        icon={IconNames.TH_LIST}
                        panel={
                            isStackedView ? (
                                <StackedPerformanceTable
                                    data={useNormalisedData ? normalisedData.data[0] : filteredRows}
                                    stackedData={filteredStackedRows}
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
                                    rawOpCodeFilter={activeRawOpCodeFilter}
                                    mathFidelityFilter={activeMathFilter}
                                    provideMatmulAdvice={provideMatmulAdvice}
                                    hiliteHighDispatch={hiliteHighDispatch}
                                    shouldHighlightRows={highlightRows && useNormalisedData}
                                    signposts={signposts}
                                />
                            )
                        }
                    />

                    {activeComparisonReportList?.map((report, index) => (
                        <Tab
                            id={report}
                            key={index}
                            icon={IconNames.TH_LIST}
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
                                isStackedView ? (
                                    <StackedPerformanceTable
                                        data={useNormalisedData ? normalisedData.data[0] : filteredRows}
                                        stackedData={processedComparisonStackedRows[comparisonIndex]}
                                        filters={filters}
                                    />
                                ) : (
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
                                        rawOpCodeFilter={activeRawOpCodeFilter}
                                        mathFidelityFilter={activeMathFilter}
                                        provideMatmulAdvice={provideMatmulAdvice}
                                        hiliteHighDispatch={hiliteHighDispatch}
                                        shouldHighlightRows={highlightRows && useNormalisedData}
                                        reportName={report}
                                        signposts={signposts}
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
    rows
        .map((row) => ({
            ...row,
            percent: parseFloat(row.percent),
            device_time_sum_us: parseFloat(row.device_time_sum_us),
            ops_count: parseFloat(row.ops_count),
            flops_min: row.flops_min ? parseFloat(row.flops_min) : null,
            flops_max: row.flops_max ? parseFloat(row.flops_max) : null,
            flops_mean: row.flops_mean ? parseFloat(row.flops_mean) : null,
            flops_std: row.flops_std ? parseFloat(row.flops_std) : null,
        }))
        .filter((row) => row.op_type !== OpType.SIGNPOST); // Filter out signposts here because they are not useful in stacked view

const renderSignpost: ItemRenderer<Signpost> = (signpost, { handleClick, handleFocus, modifiers, query }) => {
    if (!modifiers.matchesPredicate) {
        return null;
    }

    return (
        <MenuItem
            active={modifiers.active}
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

export default PerformanceReport;
