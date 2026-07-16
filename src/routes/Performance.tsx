// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Size, Tab, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom, useAtomValue } from 'jotai';
import { HttpStatusCode } from 'axios';
import getResponseError from '../functions/getResponseError';
import {
    useL1PressureByOperation,
    useOpToPerfIdFiltered,
    usePerfFolderList,
    usePerfMeta,
    usePerfMetas,
    usePerformanceComparisonReport,
    usePerformanceRange,
    usePerformanceReport,
} from '../hooks/useAPI';
import { useResetPerfTableSessionState } from '../hooks/useResetPerfTableSessionState';
import LoadingSpinner from '../components/LoadingSpinner';
import PerformanceReport from '../components/performance/PerfReport';
import {
    activePerformanceReportAtom,
    comparisonPerformanceReportListAtom,
    perfSelectedTabAtom,
    selectedPerformanceRangeAtom,
} from '../store/app';
import PerformanceChartsTab from '../components/performance/PerformanceChartsTab';
import { Marker, MarkerColours, TypedPerfTableRow } from '../definitions/PerfTable';
import { L1PressureStatus } from '../functions/l1Pressure';
import { annotatePerfHeuristicFlags } from '../functions/computePerfHeuristicFlags';
import { resolveMaxCores } from '../functions/getCoreCount';
import { enrichRowData } from '../functions/enrichPerfRowData';
import ComparisonReportSelector from '../components/performance/ComparisonReportSelector';
import 'styles/routes/Performance.scss';
import getServerConfig from '../functions/getServerConfig';
import { OpType, PerfTabIds } from '../definitions/Performance';
import { StackedColumnKeys, StackedPerfRow, TypedStackedPerfRow } from '../definitions/StackedPerfTable';

const INITIAL_TAB_ID = PerfTabIds.TABLE;
const EMPTY_COMPARISON_ROWS: TypedPerfTableRow[][] = [];
const EMPTY_COMPARISON_MAX_CORES: number[] = [];

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
    const { data: deviceMeta } = usePerfMeta(activePerformanceReport?.reportName ?? null);
    // Combined to `(MetaData | null)[]` so comparison enrichment memos on stable data, not per-render query objects.
    const comparisonDeviceMetas = usePerfMetas(comparisonReportList);
    // Reserve the column while still loading so it doesn't pop in and shift the table sideways;
    // hide it only once we know the data is genuinely unavailable.
    const hasL1PressureData = l1Pressure.status !== L1PressureStatus.Unavailable;
    const resetPerfTableSessionState = useResetPerfTableSessionState();
    // undefined until first effect run so we skip the mount cycle and clear only on path change
    const previousReportPathRef = useRef<string | null | undefined>(undefined);

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

    // Prefer the user's selected range, but don't wait on RangeSlider's sync effect — when
    // selectedRange is still null (or left over from a disjoint prior report) fall back to
    // the report's full span so we never flash "No data to display" after the skeleton.
    const rangeForTable = useMemo(() => {
        if (!perfRange) {
            return selectedRange;
        }

        if (!selectedRange) {
            return perfRange;
        }

        const selectionMissesReport = selectedRange[1] < perfRange[0] || selectedRange[0] > perfRange[1];

        return selectionMissesReport ? perfRange : selectedRange;
    }, [selectedRange, perfRange]);

    const rangedData = useMemo(
        () =>
            rangeForTable && perfData
                ? perfData.filter((row) => {
                      const rowId = typeof row?.id === 'number' ? row.id : parseInt(row?.id, 10);
                      return rowId >= rangeForTable[0] && rowId <= rangeForTable[1];
                  })
                : [],
        [rangeForTable, perfData],
    );

    // Report finished but range not yet derived (should be rare with the fallback above).
    const isTableLoading = isLoadingPerformance || (!!perfData?.length && rangeForTable === null);

    const typedRows = useMemo(
        () => enrichRowData(rangedData, opIdsMap, l1PressureMap),
        [rangedData, opIdsMap, l1PressureMap],
    );

    const maxCores = useMemo(() => resolveMaxCores(deviceMeta, typedRows), [deviceMeta, typedRows]);

    const enrichedData = useMemo(() => annotatePerfHeuristicFlags(typedRows, maxCores), [typedRows, maxCores]);

    // Each comparison dataset is thresholded with its own device capacity (meta when
    // available, else row/architecture fallback) so cross-architecture compares stay honest.
    const { enrichedComparisonData, comparisonMaxCores } = useMemo(() => {
        if (!comparisonPerfData?.length) {
            return { enrichedComparisonData: EMPTY_COMPARISON_ROWS, comparisonMaxCores: EMPTY_COMPARISON_MAX_CORES };
        }

        const maxCoresByDataset: number[] = [];
        const annotatedByDataset = comparisonPerfData.map((dataset, index) => {
            // L1 pressure comes from the active profiler report only — never attribute it to
            // comparison datasets (op-id sync and buffer lookups are keyed to the active report).
            const comparisonTypedRows = enrichRowData(dataset, opIdsMap, null);
            const datasetMaxCores = resolveMaxCores(comparisonDeviceMetas[index], comparisonTypedRows);
            maxCoresByDataset.push(datasetMaxCores);

            return annotatePerfHeuristicFlags(comparisonTypedRows, datasetMaxCores);
        });

        return { enrichedComparisonData: annotatedByDataset, comparisonMaxCores: maxCoresByDataset };
    }, [comparisonPerfData, opIdsMap, comparisonDeviceMetas]);

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
        const nextPath = activePerformanceReport?.path ?? null;
        const previousPath = previousReportPathRef.current;

        if (previousPath === undefined) {
            previousReportPathRef.current = nextPath;
            return;
        }

        if (previousPath === nextPath) {
            return;
        }

        previousReportPathRef.current = nextPath;
        resetPerfTableSessionState();
    }, [activePerformanceReport?.path, resetPerfTableSessionState]);

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
                            isLoading={isTableLoading}
                            isComparisonLoading={isLoadingComparison}
                            maxCores={maxCores}
                            comparisonMaxCores={comparisonMaxCores}
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
