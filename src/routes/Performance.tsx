// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { Size, Tab, TabId, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom, useAtomValue } from 'jotai';
import { HttpStatusCode } from 'axios';
import {
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
    selectedPerformanceRangeAtom,
} from '../store/app';
import PerfCharts from '../components/performance/PerfCharts';
import PerfChartFilter from '../components/performance/PerfChartFilter';
import { MARKER_COLOURS, Marker, OpType, PerfTableRow } from '../definitions/PerfTable';
import NonFilterablePerfCharts from '../components/performance/NonFilterablePerfCharts';
import ComparisonReportSelector from '../components/performance/ComparisonReportSelector';
import 'styles/routes/Performance.scss';
import getServerConfig from '../functions/getServerConfig';

const INITIAL_TAB_ID = 'tab-1';

export default function Performance() {
    const [comparisonReportList, setComparisonReportList] = useAtom(comparisonPerformanceReportListAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedPerformanceRangeAtom);

    const {
        data,
        isLoading: isLoadingPerformance,
        error: perfDataError,
    } = usePerformanceReport(activePerformanceReport);
    const { data: comparisonData } = usePerformanceComparisonReport();
    const { data: folderList } = usePerfFolderList();
    const perfRange = usePerformanceRange();

    const shouldDisableComparison = getServerConfig()?.SERVER_MODE;

    const perfData = data?.report;
    const stackedData = data?.stacked_report;

    const comparisonPerfData = useMemo(() => comparisonData?.map((d) => d.report) || [], [comparisonData]);
    const comparisonStackedData = useMemo(() => comparisonData?.map((d) => d.stacked_report) || [], [comparisonData]);

    // useClearSelectedBuffer();

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
            colour: MARKER_COLOURS[index],
        }));
    }, [perfData, comparisonPerfData]);

    const [selectedTabId, setSelectedTabId] = useState<TabId>(INITIAL_TAB_ID);
    const [filteredPerfData, setFilteredPerfData] = useState<PerfTableRow[]>([]);
    const [filteredComparisonData, setFilteredComparisonData] = useState<PerfTableRow[][]>([]);
    const [selectedOpCodes, setSelectedOpCodes] = useState<Marker[]>(opCodeOptions);

    // Clear comparison report if users switches active perf report to the comparison report
    useEffect(() => {
        if (activePerformanceReport && comparisonReportList?.includes(activePerformanceReport)) {
            const filteredReports = comparisonReportList.filter((report) => report !== activePerformanceReport);

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
        setFilteredComparisonData(
            comparisonPerfData?.map((dataset) =>
                dataset.filter((row) =>
                    selectedOpCodes.length
                        ? selectedOpCodes.map((selected) => selected.opCode).includes(row.raw_op_code ?? '')
                        : false,
                ),
            ) || [],
        );
    }, [selectedOpCodes, comparisonPerfData]);

    useEffect(() => {
        setFilteredPerfData(
            perfData?.filter((row) =>
                selectedOpCodes.length
                    ? selectedOpCodes.map((selected) => selected.opCode).includes(row.raw_op_code ?? '') ||
                      row.op_type === OpType.SIGNPOST
                    : false,
            ) || [],
        );
    }, [selectedOpCodes, perfData]);

    useEffect(() => {
        setSelectedOpCodes(opCodeOptions);
    }, [opCodeOptions]);

    const rangedData = useMemo(
        () =>
            !comparisonReportList && selectedRange && filteredPerfData.length > 0
                ? filteredPerfData.filter((row) => {
                      const rowId = parseInt(row?.id, 10);
                      return rowId >= selectedRange[0] && rowId <= selectedRange[1];
                  })
                : filteredPerfData,
        [selectedRange, filteredPerfData, comparisonReportList],
    );

    if (isLoadingPerformance && !perfDataError) {
        return <LoadingSpinner />;
    }

    if (perfDataError?.status === HttpStatusCode.UnprocessableEntity) {
        return (
            <>
                <h2>Unable to process performance data</h2>
                <p>
                    Data format is not supported, try using{' '}
                    <a href='https://github.com/tenstorrent/ttnn-visualizer/releases/tag/v0.49.0'>
                        TT-NN Visualizer v0.49.0
                    </a>{' '}
                    or earlier, or regenerate performance report using a newer version of{' '}
                    <a href='https://github.com/tenstorrent/tt-metal/'>TT-Metal</a>.
                </p>
            </>
        );
    }

    const reportSelectors =
        comparisonReportList && comparisonReportList?.length > 0 ? [...comparisonReportList, null] : [null];

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
                            data={rangedData}
                            comparisonData={filteredComparisonData}
                            stackedData={stackedData}
                            comparisonStackedData={comparisonStackedData}
                            signposts={data?.signposts}
                        />
                    }
                />

                <Tab
                    id='tab-2'
                    title='Charts'
                    icon={IconNames.TIMELINE_AREA_CHART}
                    panel={
                        <div className='chart-tab'>
                            <h3 className='title'>Performance charts</h3>

                            {perfData ? (
                                <>
                                    <div className='charts-container'>
                                        <PerfChartFilter
                                            opCodeOptions={opCodeOptions}
                                            selectedOpCodes={selectedOpCodes}
                                            updateOpCodes={setSelectedOpCodes}
                                        />

                                        <PerfCharts
                                            filteredPerfData={rangedData}
                                            comparisonData={filteredComparisonData}
                                            selectedOpCodes={selectedOpCodes}
                                        />
                                    </div>

                                    <div className='charts-container non-filterable-charts'>
                                        <span />

                                        <div>
                                            <NonFilterablePerfCharts
                                                chartData={rangedData}
                                                secondaryData={comparisonPerfData || []}
                                                opCodeOptions={opCodeOptions}
                                            />
                                        </div>
                                    </div>
                                </>
                            ) : null}
                        </div>
                    }
                />
            </Tabs>
        </div>
    );
}
