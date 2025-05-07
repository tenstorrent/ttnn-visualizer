// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { Button, ButtonVariant, FormGroup, Size, Tab, TabId, Tabs } from '@blueprintjs/core';
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
import LocalFolderPicker from '../components/report-selection/LocalFolderPicker';
import {
    activePerformanceReportAtom,
    comparisonPerformanceReportAtom,
    selectedPerformanceRangeAtom,
} from '../store/app';
import PerfCharts from '../components/performance/PerfCharts';
import PerfChartFilter from '../components/performance/PerfChartFilter';
import { MARKER_COLOURS, Marker, PerfTableRow } from '../definitions/PerfTable';
import NonFilterablePerfCharts from '../components/performance/NonFilterablePerfCharts';

export default function Performance() {
    const [comparisonReport, setComparisonReport] = useAtom(comparisonPerformanceReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const [selectedRange, setSelectedRange] = useAtom(selectedPerformanceRangeAtom);

    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog();
    const { data: perfData, isLoading: isLoadingPerformance } = usePerformanceReport(activePerformanceReport);
    const { data: comparisonData } = usePerformanceComparisonReport(comparisonReport);
    const { data: folderList } = usePerfFolderList();
    const perfRange = usePerformanceRange();

    useClearSelectedBuffer();

    const opCodeOptions = useMemo(() => {
        const opCodes = Array.from(
            new Set([
                ...(perfData
                    ?.map((row) => row.raw_op_code)
                    .filter((opCode): opCode is string => opCode !== undefined) || []),
                ...(comparisonData
                    ?.map((row) => row.raw_op_code)
                    .filter((opCode): opCode is string => opCode !== undefined) || []),
            ]),
        );

        return opCodes.map((opCode, index) => ({
            opCode,
            colour: MARKER_COLOURS[index],
        }));
    }, [perfData, comparisonData]);

    const [selectedTabId, setSelectedTabId] = useState<TabId>('tab-1');
    const [filteredPerfData, setFilteredPerfData] = useState<PerfTableRow[]>([]);
    const [filteredComparisonData, setFilteredComparisonData] = useState<PerfTableRow[]>([]);
    const [selectedOpCodes, setSelectedOpCodes] = useState<Marker[]>(opCodeOptions);

    // Clear comparison report if users switches active perf report to the comparison report
    useEffect(() => {
        if (comparisonReport === activePerformanceReport) {
            setComparisonReport(null);
        }
    }, [comparisonReport, activePerformanceReport, setComparisonReport]);

    // If a comparison report is selected, clear the selected range as we don't currently support ranges for comparison
    useEffect(() => {
        if (comparisonReport && perfRange) {
            setSelectedRange([perfRange[0], perfRange[1]]);
        }
    }, [comparisonReport, setSelectedRange, perfRange]);

    useEffect(() => {
        setFilteredComparisonData(
            comparisonData?.filter((row) =>
                selectedOpCodes.length
                    ? selectedOpCodes.map((selected) => selected.opCode).includes(row.raw_op_code ?? '')
                    : false,
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
            !comparisonReport && selectedRange && filteredPerfData.length > 0
                ? filteredPerfData.filter((row) => {
                      const rowId = parseInt(row?.id, 10);
                      return rowId >= selectedRange[0] && rowId <= selectedRange[1];
                  })
                : filteredPerfData,
        [selectedRange, filteredPerfData, comparisonReport],
    );

    if (isLoadingPerformance || isLoadingDeviceLog) {
        return <LoadingSpinner />;
    }

    const architecture = (deviceLog?.deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE) as DeviceArchitecture;
    const maxCores = perfData ? getCoreCount(architecture, perfData) : 0;

    return (
        <div className='performance data-padding'>
            <Helmet title='Performance' />

            <h1 className='page-title'>Performance analysis</h1>

            {folderList ? (
                <FormGroup
                    className='form-group'
                    label={<h3 className='label'>Compare</h3>}
                    subLabel='Select a performance report to compare'
                >
                    <div className='folder-selection'>
                        <LocalFolderPicker
                            items={folderList.filter((folder: string) => folder !== activePerformanceReport)}
                            value={comparisonReport}
                            handleSelect={(value) => setComparisonReport(value)}
                        />

                        <Button
                            className='clear-selection'
                            variant={ButtonVariant.OUTLINED}
                            icon={IconNames.CROSS}
                            onClick={() => setComparisonReport(null)}
                        />
                    </div>
                </FormGroup>
            ) : (
                <LoadingSpinner />
            )}

            <Tabs
                id='performance-tabs'
                selectedTabId={selectedTabId}
                onChange={setSelectedTabId}
                renderActiveTabPanelOnly
                size={Size.LARGE}
            >
                <Tab
                    id='tab-1'
                    title='Table'
                    icon={IconNames.TH}
                    panel={<PerformanceReport data={rangedData} />}
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
                                            comparisonData={[filteredComparisonData]}
                                            maxCores={maxCores}
                                            selectedOpCodes={selectedOpCodes}
                                        />
                                    </div>

                                    <div className='charts-container non-filterable-charts'>
                                        <span />

                                        <div>
                                            <NonFilterablePerfCharts
                                                chartData={rangedData}
                                                secondaryData={[comparisonData || []]}
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
