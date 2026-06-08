// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Size, Tab, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { HttpStatusCode } from 'axios';
import getResponseError from '../functions/getResponseError';
import {
    useL1PressureByOperation,
    useOpToPerfIdFiltered,
    usePerfFolderList,
    usePerformanceComparisonReport,
    usePerformanceRange,
    usePerformanceReport,
} from '../hooks/useAPI';
import LoadingSpinner from '../components/LoadingSpinner';
import PerformanceReport from '../components/performance/PerfReport';
import {
    activePerformanceReportAtom,
    comparisonPerformanceReportListAtom,
    perfSelectedTabAtom,
    selectedPerfRowIdAtom,
    selectedPerformanceRangeAtom,
} from '../store/app';
import PerformanceChartsTab from '../components/performance/PerformanceChartsTab';
import { Marker, MarkerColours, PerfTableRow, TypedPerfTableRow } from '../definitions/PerfTable';
import { L1PressureMetrics, L1PressureStatus } from '../functions/l1Pressure';
import ComparisonReportSelector from '../components/performance/ComparisonReportSelector';
import 'styles/routes/Performance.scss';
import getServerConfig from '../functions/getServerConfig';
import { HIGH_DISPATCH_THRESHOLD_MS, OpType, PerfTabIds } from '../definitions/Performance';
import { BufferType } from '../model/BufferType';
import { DeviceOperationLayoutTypes } from '../model/APIData';
import { StackedColumnKeys, StackedPerfRow, TypedStackedPerfRow } from '../definitions/StackedPerfTable';
import { parsePerfRowTensorAttributes } from '../functions/parsePerfRowTensorAttributes';

const INITIAL_TAB_ID = PerfTabIds.TABLE;

export default function Performance() {
    const [comparisonReportList, setComparisonReportList] = useAtom(comparisonPerformanceReportListAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedPerformanceRangeAtom);
    const [selectedTabId, setSelectedTabId] = useAtom(perfSelectedTabAtom);
    const [selectedOpCodes, setSelectedOpCodes] = useState<Marker[]>([]);
    const [hasUserChangedOpCodeFilter, setHasUserChangedOpCodeFilter] = useState(false);
    const [appliedOpCodeOptionsKey, setAppliedOpCodeOptionsKey] = useState<string | null>(null);

    const setSelectedOpCodesFromUser = useCallback((update: Marker[] | ((previous: Marker[]) => Marker[])) => {
        setHasUserChangedOpCodeFilter(true);
        setSelectedOpCodes(update);
    }, []);

    const {
        data,
        isLoading: isLoadingPerformance,
        error: perfDataError,
    } = usePerformanceReport(activePerformanceReport?.reportName || null);
    const { data: comparisonData, isLoading: isLoadingComparison } = usePerformanceComparisonReport();
    const { data: folderList } = usePerfFolderList();
    const perfRange = usePerformanceRange();
    const opIdsMap = useOpToPerfIdFiltered();
    const l1Pressure = useL1PressureByOperation();
    const l1PressureMap = l1Pressure.data;
    // Reserve the column while still loading so it doesn't pop in and shift the table sideways;
    // hide it only once we know the data is genuinely unavailable.
    const hasL1PressureData = l1Pressure.status !== L1PressureStatus.Unavailable;
    const setSelectedPerfRowId = useSetAtom(selectedPerfRowIdAtom);

    const shouldDisableComparison = getServerConfig()?.SERVER_MODE;

    const perfData = data?.report;
    const stackedData = data?.stacked_report;
    const reportSelectors =
        comparisonReportList && comparisonReportList?.length > 0 ? [...comparisonReportList, null] : [null];
    const comparisonPerfData = useMemo(() => comparisonData?.map((d) => d.report) || [], [comparisonData]);
    const comparisonStackedData = useMemo(() => comparisonData?.map((d) => d.stacked_report) || [], [comparisonData]);
    const opCodeOptions = useMemo(() => {
        const opCodes = Array.from(
            new Set([
                ...(perfData
                    ?.filter((row) => row.op_type !== OpType.SIGNPOST)
                    .map((row) => row.raw_op_code)
                    .filter((opCode): opCode is string => opCode !== undefined) || []),
                ...(comparisonPerfData
                    ? comparisonPerfData.flatMap((report) =>
                          report
                              .filter((row) => row.op_type !== OpType.SIGNPOST)
                              .map((row) => row.raw_op_code)
                              .filter((opCode): opCode is string => opCode !== undefined),
                      )
                    : []),
            ]),
        );

        return opCodes.map((opCode, index) => ({
            opCode,
            colour: MarkerColours[index],
        }));
    }, [perfData, comparisonPerfData]);

    const opCodeOptionsKey = useMemo(
        () => opCodeOptions.map((o) => `${o.opCode}:${o.colour}`).join('|'),
        [opCodeOptions],
    );

    const rangedData = useMemo(
        () =>
            selectedRange && perfData
                ? perfData.filter((row) => {
                      const rowId = typeof row?.id === 'number' ? row.id : parseInt(row?.id, 10);
                      return rowId >= selectedRange[0] && rowId <= selectedRange[1];
                  })
                : [],
        [selectedRange, perfData],
    );

    const enrichedData = useMemo(
        () => enrichRowData(rangedData, opIdsMap, l1PressureMap),
        [rangedData, opIdsMap, l1PressureMap],
    );
    const enrichedComparisonData = useMemo(
        // L1 metrics come from the active memory report only — do not attach the active report's map here.
        () => comparisonPerfData?.map((dataset) => enrichRowData(dataset, opIdsMap, null)) || [],
        [comparisonPerfData, opIdsMap],
    );

    const selectedOpCodeSet = useMemo(
        () => new Set(selectedOpCodes.map((selected) => selected.opCode)),
        [selectedOpCodes],
    );

    const filteredEnrichedData = useMemo(() => {
        if (opCodeOptions.length === 0) {
            return enrichedData;
        }

        if (selectedOpCodes.length === 0) {
            if (!hasUserChangedOpCodeFilter) {
                return enrichedData;
            }

            return [];
        }

        return enrichedData.filter((row) => row.raw_op_code !== undefined && selectedOpCodeSet.has(row.raw_op_code));
    }, [enrichedData, hasUserChangedOpCodeFilter, opCodeOptions.length, selectedOpCodes.length, selectedOpCodeSet]);

    const filteredEnrichedComparisonData = useMemo(() => {
        if (opCodeOptions.length === 0) {
            return enrichedComparisonData;
        }

        if (selectedOpCodes.length === 0) {
            if (!hasUserChangedOpCodeFilter) {
                return enrichedComparisonData;
            }

            return enrichedComparisonData.map(() => []);
        }

        return enrichedComparisonData.map((dataset) =>
            dataset.filter((row) => row.raw_op_code !== undefined && selectedOpCodeSet.has(row.raw_op_code)),
        );
    }, [
        enrichedComparisonData,
        hasUserChangedOpCodeFilter,
        opCodeOptions.length,
        selectedOpCodes.length,
        selectedOpCodeSet,
    ]);
    const enrichedStackedData = useMemo(() => (stackedData ? enrichStackedRowData(stackedData) : []), [stackedData]);
    const enrichedComparisonStackedData = useMemo(
        () => comparisonStackedData?.map((dataset) => enrichStackedRowData(dataset)) || [],
        [comparisonStackedData],
    );

    useEffect(() => {
        setSelectedPerfRowId(null);
    }, [activePerformanceReport?.path, setSelectedPerfRowId]);

    // Clear comparison report if users switches active perf report to the comparison report
    useEffect(() => {
        if (activePerformanceReport && comparisonReportList?.includes(activePerformanceReport?.path)) {
            const filteredReports = comparisonReportList.filter((report) => report !== activePerformanceReport?.path);

            setComparisonReportList(filteredReports.length === 0 ? null : filteredReports);
        }
    }, [comparisonReportList, activePerformanceReport, setComparisonReportList]);

    // If a comparison report is selected, clear the selected range as we don't currently support ranges for comparison
    useEffect(() => {
        if (comparisonReportList && perfRange) {
            setSelectedRange([perfRange[0], perfRange[1]]);
        }
    }, [comparisonReportList, setSelectedRange, perfRange]);

    useEffect(() => {
        if (appliedOpCodeOptionsKey === null || opCodeOptionsKey !== appliedOpCodeOptionsKey) {
            // Has sufficient guard conditions
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setAppliedOpCodeOptionsKey(opCodeOptionsKey);
            setHasUserChangedOpCodeFilter(false);
            setSelectedOpCodes(opCodeOptions);
        }
    }, [appliedOpCodeOptionsKey, opCodeOptionsKey, opCodeOptions]);

    if (perfDataError?.status === HttpStatusCode.UnprocessableEntity) {
        return (
            <>
                <h2>Unable to load performance data</h2>
                <p>
                    Data format is not supported, try using{' '}
                    <a href='https://github.com/tenstorrent/ttnn-visualizer/releases/tag/v0.49.0'>
                        TT-NN Visualizer v0.49.0
                    </a>{' '}
                    or earlier, or regenerate performance report using a newer version of{' '}
                    <a href='https://github.com/tenstorrent/tt-metal/'>TT-Metal</a>.
                </p>

                <code className='formatted-code'>{getResponseError(perfDataError)}</code>
            </>
        );
    }

    return (
        <div className='performance data-padding'>
            <Helmet title='Performance' />

            <h1 className='page-title'>Performance analysis</h1>

            {!shouldDisableComparison &&
                (folderList ? (
                    <div className='comparison-selectors'>
                        {folderList &&
                            reportSelectors?.map((_, index) => (
                                <ComparisonReportSelector
                                    className='report-selector'
                                    key={`${index}-comparison-report-selector`}
                                    folderList={folderList}
                                    reportIndex={index}
                                    label={index === 0 ? <h2 className='label'>Compare</h2> : null}
                                    subLabel={index === 0 ? 'Select from performance reports to compare' : ''}
                                />
                            ))}
                    </div>
                ) : (
                    <LoadingSpinner />
                ))}

            <Tabs
                id='performance-tabs'
                selectedTabId={selectedTabId}
                onChange={setSelectedTabId}
                renderActiveTabPanelOnly
                size={Size.LARGE}
            >
                <Tab
                    id={INITIAL_TAB_ID}
                    title='Table'
                    icon={IconNames.TH}
                    panel={
                        <PerformanceReport
                            data={enrichedData}
                            comparisonData={enrichedComparisonData}
                            stackedData={enrichedStackedData}
                            comparisonStackedData={enrichedComparisonStackedData}
                            signposts={data?.signposts}
                            hasL1PressureData={hasL1PressureData}
                            isLoading={isLoadingPerformance}
                            isComparisonLoading={isLoadingComparison}
                        />
                    }
                />

                <Tab
                    id={PerfTabIds.CHARTS}
                    title='Charts'
                    icon={IconNames.TIMELINE_AREA_CHART}
                    panel={
                        <div className='chart-tab'>
                            <h3 className='title'>Performance charts</h3>

                            {perfData ? (
                                <PerformanceChartsTab
                                    filteredPerfData={filteredEnrichedData}
                                    filteredComparisonData={filteredEnrichedComparisonData}
                                    enrichedData={enrichedData}
                                    enrichedComparisonData={enrichedComparisonData}
                                    selectedOpCodes={selectedOpCodes}
                                    opCodeOptions={opCodeOptions}
                                    updateOpCodes={setSelectedOpCodesFromUser}
                                />
                            ) : null}
                        </div>
                    }
                />
            </Tabs>
        </div>
    );
}

interface RowAttributes {
    buffer_type: BufferType | null;
    layout: DeviceOperationLayoutTypes | null;
}

const getRowAttributes = (row: PerfTableRow): RowAttributes => {
    const { buffer_type: bufferType, layout } = parsePerfRowTensorAttributes(row);

    return {
        buffer_type: bufferType,
        layout,
    };
};

const enrichRowData = (
    rows: PerfTableRow[],
    opIdsMap: { perfId?: string; opId: number }[],
    l1PressureMap: Map<number, L1PressureMetrics> | null,
): TypedPerfTableRow[] => {
    // Build the perf-id -> op-id lookup once so enrichment stays O(N) instead of O(N·M) — the
    // previous `.find()` per row scaled with both row count and the active report's op count.
    const opIdByPerfId = new Map<string, number>();
    for (const { perfId, opId } of opIdsMap) {
        if (perfId !== undefined) {
            opIdByPerfId.set(perfId, opId);
        }
    }

    const typedRows = rows.map((row) => {
        const val = parseInt(row.op_to_op_gap, 10);
        const op = opIdByPerfId.get(row.id);
        // TTNN-op snapshot is shared by all device ops that map to the same row.op.
        const l1Pressure = op !== undefined ? l1PressureMap?.get(op) : undefined;

        return {
            ...row,
            op,
            high_dispatch: !!val && val > HIGH_DISPATCH_THRESHOLD_MS,
            id: parseInt(row.id, 10),
            total_percent: parseFloat(row.total_percent),
            device: parseInt(row.device, 10) ?? null,
            device_time: parseFloat(row.device_time),
            op_to_op_gap: row.op_to_op_gap ? parseFloat(row.op_to_op_gap) : null,
            cores: parseInt(row.cores, 10),
            dram: row.dram ? parseFloat(row.dram) : null,
            dram_percent: row.dram_percent ? parseFloat(row.dram_percent) : null,
            flops: row.flops ? parseFloat(row.flops) : null,
            flops_percent: row.flops_percent ? parseFloat(row.flops_percent) : null,
            pm_ideal_ns: row.pm_ideal_ns ? parseFloat(row.pm_ideal_ns) : null,
            l1_fullness_percent: l1Pressure?.fullnessPercent ?? null,
            l1_free_segments: l1Pressure?.freeSegments ?? null,
            l1_largest_free: l1Pressure?.largestFreeBytes ?? null,
            l1_largest_free_percent: l1Pressure?.largestFreePercent ?? null,
            ...getRowAttributes(row),
            isFirstHashOccurrence: true, // Default to true, will be updated if needed in next step
        };
    });

    // Mark which rows are the first occurrence of each hash
    const hashFirstOccurrence = new Map<string | null, boolean>();
    for (const row of typedRows) {
        if (row.hash && !hashFirstOccurrence.has(row.hash)) {
            hashFirstOccurrence.set(row.hash, true);
            row.isFirstHashOccurrence = true;
        } else if (row.hash) {
            row.isFirstHashOccurrence = false;
        }
    }

    return typedRows;
};

const enrichStackedRowData = (rows: StackedPerfRow[]): TypedStackedPerfRow[] =>
    rows.map((row) => ({
        ...row,
        [StackedColumnKeys.Percent]: row[StackedColumnKeys.Percent] ? parseFloat(row[StackedColumnKeys.Percent]) : null,
        [StackedColumnKeys.Device]: row[StackedColumnKeys.Device] ? parseInt(row[StackedColumnKeys.Device], 10) : null,
        [StackedColumnKeys.DeviceTimeSumUs]: row[StackedColumnKeys.DeviceTimeSumUs]
            ? parseFloat(row[StackedColumnKeys.DeviceTimeSumUs])
            : null,
        [StackedColumnKeys.OpsCount]: row[StackedColumnKeys.OpsCount]
            ? parseFloat(row[StackedColumnKeys.OpsCount])
            : null,
        [StackedColumnKeys.FlopsMin]: row[StackedColumnKeys.FlopsMin]
            ? parseFloat(row[StackedColumnKeys.FlopsMin])
            : null,
        [StackedColumnKeys.FlopsMax]: row[StackedColumnKeys.FlopsMax]
            ? parseFloat(row[StackedColumnKeys.FlopsMax])
            : null,
        [StackedColumnKeys.FlopsMean]: row[StackedColumnKeys.FlopsMean]
            ? parseFloat(row[StackedColumnKeys.FlopsMean])
            : null,
        [StackedColumnKeys.FlopsStd]: row[StackedColumnKeys.FlopsStd]
            ? parseFloat(row[StackedColumnKeys.FlopsStd])
            : null,
        [StackedColumnKeys.FlopsWeightedMean]: row[StackedColumnKeys.FlopsWeightedMean]
            ? parseFloat(row[StackedColumnKeys.FlopsWeightedMean])
            : null,
    }));
