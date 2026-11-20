// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Dispatch, JSX, SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
    Button,
    ButtonGroup,
    ButtonVariant,
    Callout,
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
import { DurationBucket, PERF_DURATION_BUCKET_FILTER_PLACEHOLDER } from '../../definitions/PerfDurationHistogram';
import { ColumnKeys, Columns } from '../../definitions/PerfTable';
import { TypedPerfTableRow } from '../../model/PerfTable';
import { Signpost } from '../../model/Signpost';
import { calcHighDispatchOps } from '../../functions/perfFunctions';
import { recordPerfTableOptionToggled } from '../../functions/surfaceEvents';
import { FilterSurface, PerfTableOption } from '../../definitions/EventLogEvent';
import useRecordFilterUsed from '../../hooks/useRecordFilterUsed';
import SearchField from '../SearchField';
import PerfTable from './PerfTable';
import {
    activePerformanceReportAtom,
    activePerformanceReportFolderNameAtom,
    bufferTypeFilterListAtom,
    comparisonPerformanceReportListAtom,
    durationBucketFilterListAtom,
    filterBySignpostAtom,
    hideHostOpsAtom,
    isStackedViewAtom,
    layoutFilterListAtom,
    mathFilterListAtom,
    mergeDevicesAtom,
    opCategoryFilterListAtom,
    rawOpCodeFilterListAtom,
    stackedGroupByAtom,
    tracingModeAtom,
} from '../../store/app';
import 'styles/components/PerfReport.scss';
import StackedPerformanceTable from './StackedPerfTable';
import {
    STACKED_GROUP_BY_LABELS,
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
import { formatSyncedReportName } from '../../functions/reportRank';
import { DeviceOperationLayoutTypes } from '../../model/APIData';
import usePerfReportFiltering from './usePerfReportFiltering';
import AllocationFailureSummary from './AllocationFailureSummary';
import isSignpostOutsideRange from '../../functions/isSignpostOutsideRange';
import { SignpostSelectType } from '../../definitions/Performance';
import { AllocationFailureListing } from '../../model/AllocationFailure';
import { useOperationsList } from '../../hooks/useAPI';
import indexFirstById from '../../functions/indexFirstById';
import { SourceLineGroup, getSourceLineGroups, isSourceLineGroupMatch } from '../../functions/perfSourceLines';
import { TEST_IDS } from '../../definitions/TestIds';
import SourceLinePerfTable from './SourceLinePerfTable';
import { getCallSiteFrame } from '../../functions/stackTraceSource';
import { sumStackedDeviceTime } from '../../functions/stackedPerfFunctions';

interface PerformanceReportProps {
    data?: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    stackedData: TypedStackedPerfRow[];
    comparisonStackedData: TypedStackedPerfRow[][];
    signposts?: Signpost[];
    hasL1PressureData?: boolean;
    isLoading?: boolean;
    isComparisonLoading?: boolean;
    maxCores: number;
    comparisonMaxCores?: number[];
    allocationFailureListings?: AllocationFailureListing[];
    /**
     * Whether any row of the whole report links to a memory-report operation. `data` holds only
     * the range slider's rows, which can all be unlinked while the report is linked.
     */
    hasLinkedOperations: boolean;
}

const EMPTY_ALLOCATION_FAILURE_LISTINGS: AllocationFailureListing[] = [];
const INITIAL_TAB_ID = 'perf-table-0'; // `perf-table-${index}`
const STACKED_GROUP_BY = [
    StackedGroupBy.CATEGORY,
    StackedGroupBy.MEMORY,
    StackedGroupBy.OP,
    StackedGroupBy.SOURCE_LINE,
];
const EMPTY_SOURCE_LINE_GROUPS: SourceLineGroup[] = [];
const SOURCE_LINE_UNLINKED = 'Needs a memory report linked to this performance report';
const SOURCE_LINE_NO_TRACES = 'No stack trace in the linked memory report names a Python frame';
const SOURCE_LINE_RANGE_NOTE = 'Source line also follows the range slider, which the other groupings ignore';
const SOURCE_LINE_COMPARISON_NOTE =
    "Source lines come from the active memory report's stack traces, so they are shown for the active performance report only.";
const OP_CODE_FILTER_PLACEHOLDER = 'Filter by operation name';
const SOURCE_LINE_FILTER_PLACEHOLDER = 'Filter by file or function';

/**
 * Drops selections the current data can no longer offer, preserving the array identity when
 * nothing changed so the effect that calls this cannot loop.
 */
const pruneToValidValues = <T,>(validValues: ReadonlySet<NonNullable<T>>, currentFilters: T[]): T[] => {
    const nextFilters = currentFilters.filter((value) => value != null && validValues.has(value));

    return nextFilters.length === currentFilters.length ? currentFilters : nextFilters;
};

/** The distinct non-null values of one row field, which are the values its chip filter can offer. */
const getDistinctValues = <K extends keyof TypedPerfTableRow>(
    rows: TypedPerfTableRow[],
    key: K,
): Set<NonNullable<TypedPerfTableRow[K]>> => {
    const values = new Set<NonNullable<TypedPerfTableRow[K]>>();

    for (const row of rows) {
        const value = row[key];

        if (value !== null && value !== undefined) {
            values.add(value);
        }
    }

    return values;
};

const PerformanceReport = ({
    data,
    comparisonData,
    stackedData,
    comparisonStackedData,
    signposts,
    hasL1PressureData = false,
    isLoading = false,
    isComparisonLoading = false,
    maxCores,
    comparisonMaxCores = [],
    allocationFailureListings = EMPTY_ALLOCATION_FAILURE_LISTINGS,
    hasLinkedOperations,
}: PerformanceReportProps) => {
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const activeReportFolderName = useAtomValue(activePerformanceReportFolderNameAtom);
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
    const [activeOpCategoryFilterList, setActiveOpCategoryFilterList] = useAtom(opCategoryFilterListAtom);
    const [activeDurationBucketFilterList, setActiveDurationBucketFilterList] = useAtom(durationBucketFilterListAtom);

    // TODO: Reimplement merge/expand device data toggle
    // const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    // const [isMultiDevice, _setIsMultiDevice] = useState<boolean>(false);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState(false);
    const [selectedTabId, setSelectedTabId] = useState<TabId>(INITIAL_TAB_ID);
    const [useNormalisedData, setUseNormalisedData] = useState(true);
    const recordOpCodeFilterUsed = useRecordFilterUsed(FilterSurface.PERF_OP_CODE);

    // Works out the list a click leaves, so removing the last code counts as no filter. The
    // setter still gets the update as given, so a functional one applies to the latest list.
    // So a functional update runs twice, which is harmless while MultiSelectField's is pure.
    const handleRawOpCodeFilterChange = useCallback(
        (update: SetStateAction<TypedPerfTableRow['raw_op_code'][]>) => {
            const next = typeof update === 'function' ? update(activeRawOpCodeFilterList) : update;

            setActiveRawOpCodeFilterList(update);
            recordOpCodeFilterUsed(next.length > 0);
        },
        [activeRawOpCodeFilterList, setActiveRawOpCodeFilterList, recordOpCodeFilterUsed],
    );

    const toggleTableOption = (setOption: Dispatch<SetStateAction<boolean>>, option: PerfTableOption) => () => {
        setOption((isOn) => !isOn);
        recordPerfTableOptionToggled(option);
    };
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
    const isTableLoading = isLoading || isComparisonLoading;
    const comparisonIndex = (activeComparisonReportList ?? []).findIndex((value) => value === selectedTabId);
    const isGroupedByMemory = stackedGroupBy === StackedGroupBy.MEMORY;
    const isSourceLineShown = isStackedView && stackedGroupBy === StackedGroupBy.SOURCE_LINE;
    const filterScopeHelperText =
        activeComparisonReportList?.length &&
        'Comparison rows are filtered together with the active report to maintain row data alignment';

    const isNormalisationApplied = !isStackedView && useNormalisedData;
    const {
        processedRows,
        processedComparisonRows,
        combinedRows,
        rawOpCodeOptions,
        durationBucketOptions,
        emptyDurationBucketMinUsSet,
        filteredRows,
        filteredComparisonRowsList,
    } = usePerfReportFiltering({
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
    });
    const labelByBucketMinUs = useMemo(
        () =>
            new Map<DurationBucket['minUs'], string>(
                durationBucketOptions.map((bucket) => [bucket.minUs, bucket.label]),
            ),
        [durationBucketOptions],
    );
    const validRawOpCodeValues = useMemo(
        () => new Set(rawOpCodeOptions.flatMap((row) => (row.raw_op_code !== null ? [row.raw_op_code] : []))),
        [rawOpCodeOptions],
    );
    const validMathFilterValues = useMemo(
        () =>
            new Set(
                combinedRows
                    .map((row) => row.math_fidelity)
                    .filter((value): value is string => value !== null && value !== ''),
            ),
        [combinedRows],
    );
    const validBufferTypeValues = useMemo(() => getDistinctValues(combinedRows, 'buffer_type'), [combinedRows]);
    const validLayoutValues = useMemo(() => getDistinctValues(combinedRows, 'layout'), [combinedRows]);
    const validOpCategoryValues = useMemo(() => getDistinctValues(combinedRows, 'op_category'), [combinedRows]);
    const validDurationBucketValues = useMemo(
        () => new Set(durationBucketOptions.map((bucket) => bucket.minUs)),
        [durationBucketOptions],
    );

    const filteredComparisonRows = useMemo(
        () => filteredComparisonRowsList[comparisonIndex] || [],
        [filteredComparisonRowsList, comparisonIndex],
    );
    // A comparison tab shows its own report as primary and every other report, the original
    // primary first, beneath it. Memoised so PerfTable does not re-align its comparison sub-rows
    // or recompute column eligibility on unrelated renders.
    const comparisonTabComparisonRows = useMemo(
        () => [filteredRows, ...filteredComparisonRowsList.filter((_, i) => i !== comparisonIndex)],
        [filteredRows, filteredComparisonRowsList, comparisonIndex],
    );

    const filteredStackedRows = useMemo(
        () =>
            sortAndFilterStackedPerfTableData(
                stackedData,
                stackedFilters,
                activeRawOpCodeFilterList,
                isGroupedByMemory,
            ),
        [stackedData, stackedFilters, activeRawOpCodeFilterList, isGroupedByMemory],
    );

    const filteredComparisonStackedRowsList = useMemo(
        () =>
            comparisonStackedData.map((dataset) =>
                sortAndFilterStackedPerfTableData(
                    dataset,
                    stackedFilters,
                    activeRawOpCodeFilterList,
                    isGroupedByMemory,
                ),
            ),
        [comparisonStackedData, stackedFilters, activeRawOpCodeFilterList, isGroupedByMemory],
    );
    const filteredComparisonStackedRows = useMemo(
        () => filteredComparisonStackedRowsList[comparisonIndex] || [],
        [filteredComparisonStackedRowsList, comparisonIndex],
    );

    // Footer shares are of the unfiltered rows' device time.
    const stackedTotalDeviceTimeUs = useMemo(() => sumStackedDeviceTime(stackedData), [stackedData]);
    const comparisonStackedTotalDeviceTimeUs = useMemo(
        () => sumStackedDeviceTime(comparisonStackedData[comparisonIndex]),
        [comparisonStackedData, comparisonIndex],
    );

    const { data: operations, isLoading: isLoadingOperations } = useOperationsList();
    // Judged on the whole report rather than the range: `some` stops at the first call site, so
    // only a report with no traces parses every operation.
    const sourceLineUnavailableReason = useMemo(() => {
        if (!hasLinkedOperations) {
            return SOURCE_LINE_UNLINKED;
        }

        return operations?.some((operation) => getCallSiteFrame(operation.stack_trace) !== null)
            ? null
            : SOURCE_LINE_NO_TRACES;
    }, [hasLinkedOperations, operations]);
    const isSourceLineAvailable = sourceLineUnavailableReason === null;
    const operationById = useMemo(() => indexFirstById(operations, (operation) => operation.id), [operations]);
    // Rolled up from `data`, never `filteredRows`: the Standard view's buffer type, layout, math
    // fidelity and duration filters stay set while Stacked hides them, and the raw op code list
    // cannot apply to a line that mixes op codes.
    const sourceLineGroups = useMemo(
        () =>
            // Unlinked or traceless, every row would sit in one group without a line, which says
            // less than the table's explanation of why there are no lines.
            isSourceLineShown && isSourceLineAvailable
                ? getSourceLineGroups(data ?? [], operationById, { mergeDevices })
                : EMPTY_SOURCE_LINE_GROUPS,
        [isSourceLineShown, isSourceLineAvailable, data, operationById, mergeDevices],
    );
    const sourceLineTotalDeviceTimeUs = useMemo(
        () => sourceLineGroups.reduce((total, group) => total + group.deviceTimeUs, 0),
        [sourceLineGroups],
    );
    const sourceLineFilterQuery = stackedFilters?.[StackedColumnKeys.OpCode] ?? '';
    // Filtered after grouping, so each line's percentage stays a share of the whole range.
    const filteredSourceLineGroups = useMemo(
        () => sourceLineGroups.filter((group) => isSourceLineGroupMatch(group, sourceLineFilterQuery)),
        [sourceLineGroups, sourceLineFilterQuery],
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

    const isInitialTab = selectedTabId === INITIAL_TAB_ID;

    // Summarises the active tab's report so the banner agrees with the Slow icons in its table.
    // Memoised so unrelated re-renders (hover) don't rescan every row.
    const highDispatchAdvice = useMemo(() => {
        if (!hiliteHighDispatch || isStackedView) {
            return null;
        }

        const activeRows = isInitialTab ? processedRows : processedComparisonRows[comparisonIndex];

        return activeRows ? calcHighDispatchOps(activeRows) : null;
    }, [hiliteHighDispatch, isStackedView, isInitialTab, processedRows, processedComparisonRows, comparisonIndex]);

    const activeDataCount = useMemo(() => {
        const isComparison = !isInitialTab;
        let filteredData;
        let processedData;

        if (isComparison) {
            filteredData = isStackedView ? filteredComparisonStackedRows : filteredComparisonRows;
            processedData = isStackedView
                ? comparisonStackedData[comparisonIndex]
                : processedComparisonRows[comparisonIndex];
        } else if (isSourceLineShown) {
            filteredData = filteredSourceLineGroups;
            processedData = sourceLineGroups;
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
        isSourceLineShown,
        filteredRows,
        processedRows,
        filteredStackedRows,
        filteredSourceLineGroups,
        sourceLineGroups,
        comparisonData,
        stackedData,
        comparisonStackedData,
        filteredComparisonRows,
        processedComparisonRows,
        filteredComparisonStackedRows,
    ]);

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

    useEffect(() => {
        setActiveRawOpCodeFilterList((currentFilters) => pruneToValidValues(validRawOpCodeValues, currentFilters));
    }, [validRawOpCodeValues, setActiveRawOpCodeFilterList]);

    useEffect(() => {
        setActiveMathFilterList((currentFilters) => pruneToValidValues(validMathFilterValues, currentFilters));
        setActiveBufferTypeFilterList((currentFilters) => pruneToValidValues(validBufferTypeValues, currentFilters));
        setActiveLayoutFilterList((currentFilters) => pruneToValidValues(validLayoutValues, currentFilters));
        setActiveOpCategoryFilterList((currentFilters) => pruneToValidValues(validOpCategoryValues, currentFilters));
        // A bucket that no longer exists would filter every row out with no visible tag to explain it
        setActiveDurationBucketFilterList((currentFilters) =>
            pruneToValidValues(validDurationBucketValues, currentFilters),
        );
    }, [
        validMathFilterValues,
        validBufferTypeValues,
        validLayoutValues,
        validOpCategoryValues,
        validDurationBucketValues,
        setActiveMathFilterList,
        setActiveBufferTypeFilterList,
        setActiveLayoutFilterList,
        setActiveOpCategoryFilterList,
        setActiveDurationBucketFilterList,
    ]);

    const renderActivePanel = () => {
        if (isSourceLineShown) {
            return (
                <SourceLinePerfTable
                    groups={filteredSourceLineGroups}
                    operationById={operationById}
                    filterQuery={sourceLineFilterQuery}
                    reportFolderName={activeReportFolderName}
                    maxCores={maxCores}
                    isLoading={isTableLoading || isLoadingOperations}
                    emptyReason={sourceLineUnavailableReason}
                    totalDeviceTimeUs={sourceLineTotalDeviceTimeUs}
                />
            );
        }

        if (isStackedView) {
            return (
                <StackedPerformanceTable
                    stackedData={filteredStackedRows}
                    totalDeviceTimeUs={stackedTotalDeviceTimeUs}
                    filters={filters}
                    stackedComparisonData={filteredComparisonStackedRowsList}
                    reportFolderName={activeReportFolderName}
                    maxCores={maxCores}
                    isLoading={isTableLoading}
                />
            );
        }

        return (
            <PerfTable
                data={filteredRows}
                comparisonData={filteredComparisonRowsList}
                filters={filters}
                provideMatmulAdvice={provideMatmulAdvice}
                hiliteHighDispatch={hiliteHighDispatch}
                reportFolderName={activeReportFolderName}
                hasL1PressureData={hasL1PressureData}
                maxCores={maxCores}
                isLoading={isTableLoading}
            />
        );
    };

    const renderComparisonPanel = (report: string, index: number) => {
        if (isSourceLineShown) {
            return (
                <Callout
                    intent={Intent.PRIMARY}
                    icon={IconNames.INFO_SIGN}
                    data-testid={TEST_IDS.PERF_SOURCE_LINE_COMPARISON_NOTICE}
                    compact
                >
                    {SOURCE_LINE_COMPARISON_NOTE}
                </Callout>
            );
        }

        if (isStackedView) {
            return (
                <StackedPerformanceTable
                    stackedData={comparisonIndex > -1 ? filteredComparisonStackedRows : filteredStackedRows}
                    totalDeviceTimeUs={
                        comparisonIndex > -1 ? comparisonStackedTotalDeviceTimeUs : stackedTotalDeviceTimeUs
                    }
                    stackedComparisonData={[
                        filteredStackedRows,
                        ...filteredComparisonStackedRowsList.filter((_, i) => i !== comparisonIndex),
                    ]}
                    filters={filters}
                    reportFolderName={report}
                    maxCores={comparisonMaxCores[index] ?? maxCores}
                    isLoading={isTableLoading}
                />
            );
        }

        return (
            <PerfTable
                data={filteredComparisonRows}
                comparisonData={comparisonTabComparisonRows}
                filters={filters}
                provideMatmulAdvice={provideMatmulAdvice}
                hiliteHighDispatch={hiliteHighDispatch}
                reportFolderName={report}
                hasL1PressureData={hasL1PressureData}
                maxCores={comparisonMaxCores[index] ?? maxCores}
                activeReportComparisonIndex={0}
                isLoading={isTableLoading}
            />
        );
    };

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
                        subLabel='Input data'
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
                                onChange={toggleTableOption(setHideHostOps, PerfTableOption.HIDE_HOST_OPS)}
                                checked={hideHostOps}
                                className='option-switch'
                            />

                            <Switch
                                label='Merge device rows'
                                onChange={toggleTableOption(setMergeDevices, PerfTableOption.MERGE_DEVICES)}
                                checked={mergeDevices}
                                className='option-switch'
                            />

                            <Tooltip
                                content='Tracing mode will skip sorting operations based on execution order'
                                position={PopoverPosition.TOP}
                            >
                                <Switch
                                    label='Tracing mode'
                                    onChange={toggleTableOption(setTracingMode, PerfTableOption.TRACING_MODE)}
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
                            helperText={isSourceLineShown ? SOURCE_LINE_RANGE_NOTE : undefined}
                        >
                            <ButtonGroup className='select-group'>
                                <Select<StackedGroupBy>
                                    activeItem={stackedGroupBy}
                                    items={STACKED_GROUP_BY}
                                    itemDisabled={(item) =>
                                        item === StackedGroupBy.SOURCE_LINE && !isSourceLineAvailable
                                    }
                                    itemRenderer={(item, itemProps) =>
                                        renderStackedGroupBy(item, itemProps, sourceLineUnavailableReason)
                                    }
                                    onItemSelect={(value) => setStackedGroupBy(value)}
                                >
                                    <Button
                                        text={STACKED_GROUP_BY_LABELS[stackedGroupBy]}
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
                        className='form-group option-row'
                    >
                        <ButtonGroup className='select-group'>
                            <SearchField
                                onQueryChanged={(value) => {
                                    updateColumnFilter(ColumnKeys.OpCode, value);
                                    recordOpCodeFilterUsed(value !== '');
                                }}
                                placeholder={
                                    isSourceLineShown ? SOURCE_LINE_FILTER_PLACEHOLDER : OP_CODE_FILTER_PLACEHOLDER
                                }
                                searchQuery={filters?.op_code || ''}
                            />

                            <MultiSelectField<TypedPerfTableRow, 'raw_op_code'>
                                keyName='raw_op_code'
                                options={rawOpCodeOptions}
                                placeholder='Select Op Codes...'
                                values={activeRawOpCodeFilterList}
                                updateHandler={handleRawOpCodeFilterChange}
                                disabled={isSourceLineShown}
                            />
                        </ButtonGroup>
                    </FormGroup>

                    {!isStackedView && (
                        <FormGroup
                            className='option-row'
                            helperText={filterScopeHelperText}
                        >
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

                                <MultiSelectField<TypedPerfTableRow, 'op_category'>
                                    keyName='op_category'
                                    options={combinedRows}
                                    placeholder='Select Op Category...'
                                    values={activeOpCategoryFilterList}
                                    updateHandler={setActiveOpCategoryFilterList}
                                />

                                <MultiSelectField<TypedPerfTableRow, 'math_fidelity'>
                                    keyName='math_fidelity'
                                    options={combinedRows}
                                    placeholder='Select Math Fidelity...'
                                    values={activeMathFilterList}
                                    updateHandler={setActiveMathFilterList}
                                    disabled={isStackedView}
                                />

                                <MultiSelectField<DurationBucket, 'minUs'>
                                    keyName='minUs'
                                    options={durationBucketOptions}
                                    labelFormatter={(minUs) => labelByBucketMinUs.get(minUs) ?? String(minUs)}
                                    placeholder={PERF_DURATION_BUCKET_FILTER_PLACEHOLDER}
                                    values={activeDurationBucketFilterList}
                                    updateHandler={setActiveDurationBucketFilterList}
                                    disabledValues={emptyDurationBucketMinUsSet}
                                />
                            </ButtonGroup>

                            <ButtonGroup className='switch-group'>
                                <Switch
                                    label='Matmul optimization analysis'
                                    onChange={toggleTableOption(setProvideMatmulAdvice, PerfTableOption.MATMUL_ADVICE)}
                                    checked={provideMatmulAdvice}
                                    className='option-switch'
                                    disabled={isStackedView}
                                />

                                <Switch
                                    label='Highlight high dispatch ops'
                                    onChange={toggleTableOption(
                                        setHiliteHighDispatch,
                                        PerfTableOption.HIGHLIGHT_HIGH_DISPATCH,
                                    )}
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
                                        onChange={toggleTableOption(
                                            setUseNormalisedData,
                                            PerfTableOption.NORMALISE_DATA,
                                        )}
                                        checked={useNormalisedData}
                                        className='option-switch'
                                    />
                                </Tooltip>
                            </ButtonGroup>
                        </FormGroup>
                    )}
                </div>

                {/* Above the table: the table's height cap assumes nothing renders below it. */}
                <AllocationFailureSummary listings={allocationFailureListings} />
                {highDispatchAdvice}

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
                        title={
                            activePerformanceReport
                                ? formatSyncedReportName(activePerformanceReport.reportName)
                                : 'Loading...'
                        }
                        icon={IconNames.TH_LIST}
                        panel={renderActivePanel()}
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
                            panel={renderComparisonPanel(report, index)}
                        />
                    ))}
                </Tabs>
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
    ): JSX.Element | null;
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

    const isOutsideRange = isSignpostOutsideRange(signpost, selectedSignposts, allSignposts, selectType);

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

interface RenderStackedGroupByProps<T> {
    (item: T, itemProps: ItemRendererProps, sourceLineUnavailableReason: string | null): JSX.Element | null;
}

const renderStackedGroupBy: RenderStackedGroupByProps<StackedGroupBy> = (
    value,
    { handleClick, handleFocus, modifiers, query, id },
    sourceLineUnavailableReason,
) => {
    if (!modifiers.matchesPredicate) {
        return null;
    }

    const text = (
        <HighlightedText
            text={STACKED_GROUP_BY_LABELS[value]}
            filter={query}
        />
    );

    return (
        <MenuItem
            active={modifiers.active}
            disabled={modifiers.disabled}
            key={id}
            onClick={handleClick}
            onFocus={handleFocus}
            roleStructure='listoption'
            text={
                modifiers.disabled && value === StackedGroupBy.SOURCE_LINE ? (
                    <Tooltip
                        content={sourceLineUnavailableReason ?? undefined}
                        position={PopoverPosition.RIGHT}
                    >
                        {text}
                    </Tooltip>
                ) : (
                    text
                )
            }
        />
    );
};

export default PerformanceReport;
