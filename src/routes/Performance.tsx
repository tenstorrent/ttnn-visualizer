// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { Size, Tab, TabId, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom, useAtomValue } from 'jotai';
import {
    useDeviceLog,
    usePerfFolderList,
    usePerformanceComparisonReport,
    usePerformanceRange,
    usePerformanceReport,
} from '../hooks/useAPI';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import LoadingSpinner from '../components/LoadingSpinner';
import PerformanceReport from '../components/performance/PerfReport';
import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import getCoreCount from '../functions/getCoreCount';
import {
    activePerformanceReportAtom,
    comparisonPerformanceReportAtom,
    selectedPerformanceRangeAtom,
} from '../store/app';
import PerfCharts from '../components/performance/PerfCharts';
import PerfChartFilter from '../components/performance/PerfChartFilter';
import { MARKER_COLOURS, Marker, PerfTableRow } from '../definitions/PerfTable';
import NonFilterablePerfCharts from '../components/performance/NonFilterablePerfCharts';
import ComparisonReportSelector from '../components/performance/ComparisonReportSelector';
import 'styles/routes/Performance.scss';
import getServerConfig from '../functions/getServerConfig';

const INITIAL_TAB_ID = 'tab-1';

export default function Performance() {
    const [comparisonReports, setComparisonReports] = useAtom(comparisonPerformanceReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedPerformanceRangeAtom);

    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog();
    const { data: perfData, isLoading: isLoadingPerformance } = usePerformanceReport(activePerformanceReport);
    const { data: comparisonData } = usePerformanceComparisonReport(comparisonReports || null);
    const { data: folderList } = usePerfFolderList();
    const perfRange = usePerformanceRange();

    const shouldDisableComparison = getServerConfig()?.SERVER_MODE;

    useClearSelectedBuffer();

    const opCodeOptions = useMemo(() => {
        const opCodes = Array.from(
            new Set([
                ...(perfData
                    ?.map((row) => row.raw_op_code)
                    .filter((opCode): opCode is string => opCode !== undefined) || []),
                ...(comparisonData
                    ? comparisonData.flatMap((report) =>
                          report
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
    }, [perfData, comparisonData]);

    const [selectedTabId, setSelectedTabId] = useState<TabId>(INITIAL_TAB_ID);
    const [filteredPerfData, setFilteredPerfData] = useState<PerfTableRow[]>([]);
    const [filteredComparisonData, setFilteredComparisonData] = useState<PerfTableRow[][]>([]);
    const [selectedOpCodes, setSelectedOpCodes] = useState<Marker[]>(opCodeOptions);

    // Clear comparison report if users switches active perf report to the comparison report
    useEffect(() => {
        if (activePerformanceReport && comparisonReports?.includes(activePerformanceReport)) {
            const filteredReports = comparisonReports.filter((report) => report !== activePerformanceReport);
            setComparisonReports(filteredReports.length === 0 ? null : filteredReports);
        }
    }, [comparisonReports, activePerformanceReport, setComparisonReports]);

    // If a comparison report is selected, clear the selected range as we don't currently support ranges for comparison
    useEffect(() => {
        if (comparisonReports && perfRange) {
            setSelectedRange([perfRange[0], perfRange[1]]);
        }
    }, [comparisonReports, setSelectedRange, perfRange]);

    useEffect(() => {
        setFilteredComparisonData(
            comparisonData?.map((dataset) =>
                dataset.filter((row) =>
                    selectedOpCodes.length
                        ? selectedOpCodes.map((selected) => selected.opCode).includes(row.raw_op_code ?? '')
                        : false,
                ),
            ) || [],
        );
    }, [selectedOpCodes, comparisonData]);

    useEffect(() => {
        setFilteredPerfData(
            perfData?.filter((row) =>
                selectedOpCodes.length
                    ? selectedOpCodes.map((selected) => selected.opCode).includes(row.raw_op_code ?? '')
                    : false,
            ) || [],
        );
    }, [selectedOpCodes, perfData]);

    useEffect(() => {
        setSelectedOpCodes(opCodeOptions);
    }, [opCodeOptions]);

    const rangedData = useMemo(
        () =>
            !comparisonReports && selectedRange && filteredPerfData.length > 0
                ? filteredPerfData.filter((row) => {
                      const rowId = parseInt(row?.id, 10);
                      return rowId >= selectedRange[0] && rowId <= selectedRange[1];
                  })
                : filteredPerfData,
        [selectedRange, filteredPerfData, comparisonReports],
    );

    if (isLoadingPerformance || isLoadingDeviceLog) {
        return <LoadingSpinner />;
    }

    const architecture = (deviceLog?.deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE) as DeviceArchitecture;
    const maxCores = perfData ? getCoreCount(architecture, perfData) : 0;
    const reportSelectors = comparisonReports && comparisonReports?.length > 0 ? [...comparisonReports, null] : [null];

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
                                    label={index === 0 ? <h3 className='label'>Compare</h3> : null}
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
                        />
                    }
                />

                <Tab
                    id='tab-2'
                    title='Charts'
                    icon={IconNames.TIMELINE_AREA_CHART}
                    panel={
                        <div className='chart-tab'>
                            <p>
                                <strong>Arch:</strong> {architecture}
                            </p>
                            <p>
                                <strong>Cores:</strong> {maxCores}
                            </p>

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
                                            maxCores={maxCores}
                                            selectedOpCodes={selectedOpCodes}
                                        />
                                    </div>

                                    <div className='charts-container non-filterable-charts'>
                                        <span />

                                        <div>
                                            <NonFilterablePerfCharts
                                                chartData={rangedData}
                                                secondaryData={comparisonData || []}
                                                maxCores={maxCores}
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
