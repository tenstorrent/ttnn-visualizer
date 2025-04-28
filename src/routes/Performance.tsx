// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { Button, ButtonVariant, FormGroup, Size, Tab, TabId, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom, useAtomValue } from 'jotai';
import { useDeviceLog, usePerfFolderList, usePerformanceComparisonReport, usePerformanceReport } from '../hooks/useAPI';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import LoadingSpinner from '../components/LoadingSpinner';
import PerformanceReport from '../components/performance/PerfReport';
import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import getCoreCount from '../functions/getCoreCount';
import LocalFolderPicker from '../components/report-selection/LocalFolderPicker';
import { activePerformanceReportAtom, comparisonPerformanceReportAtom } from '../store/app';
import PerfCharts from '../components/performance/PerfCharts';
import PerfChartFilter from '../components/performance/PerfChartFilter';
import { MARKER_COLOURS, Marker, PerfTableRow } from '../definitions/PerfTable';
import NonFilterablePerfCharts from '../components/performance/NonFilterablePerfCharts';

export default function Performance() {
    const [comparisonReport, setComparisonReport] = useAtom(comparisonPerformanceReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog();
    const { data: perfData, isLoading: isLoadingPerformance } = usePerformanceReport(activePerformanceReport);
    const { data: comparisonData } = usePerformanceComparisonReport(comparisonReport);
    const { data: folderList } = usePerfFolderList();

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

    useEffect(() => {
        if (comparisonReport === activePerformanceReport) {
            setComparisonReport(null);
        }
    }, [comparisonReport, activePerformanceReport, setComparisonReport]);

    useEffect(() => {
        setFilteredComparisonData(
            comparisonData
                ?.filter((row) =>
                    selectedOpCodes.length
                        ? selectedOpCodes.map((selected) => selected.opCode).includes(row.raw_op_code ?? '')
                        : false,
                )
                .sort((a, b) => (a.raw_op_code ?? '').localeCompare(b.raw_op_code ?? '')) || [],
        );
    }, [selectedOpCodes, comparisonData]);

    useEffect(() => {
        setFilteredPerfData(
            perfData
                ?.filter((row) =>
                    selectedOpCodes.length
                        ? selectedOpCodes.map((selected) => selected.opCode).includes(row.raw_op_code ?? '')
                        : false,
                )
                .sort((a, b) => (a.raw_op_code ?? '').localeCompare(b.raw_op_code ?? '')) || [],
        );
    }, [selectedOpCodes, perfData]);

    useEffect(() => {
        setSelectedOpCodes(opCodeOptions);
    }, [opCodeOptions]);

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
                    panel={<PerformanceReport data={perfData} />}
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
                                            filteredPerfData={filteredPerfData}
                                            comparisonData={[filteredComparisonData]}
                                            maxCores={maxCores}
                                            selectedOpCodes={selectedOpCodes}
                                        />

                                        {/* {comparisonReport ? (
                                            <PerfCharts
                                                filteredPerfData={filteredComparisonData}
                                                maxCores={maxCores}
                                                selectedOpCodes={selectedOpCodes}
                                                title={comparisonReport}
                                            />
                                        ) : null} */}
                                    </div>

                                    <div className='charts-container non-filterable-charts'>
                                        <span />

                                        <div>
                                            <NonFilterablePerfCharts
                                                chartData={perfData}
                                                secondaryData={comparisonData}
                                                maxCores={maxCores}
                                                opCodeOptions={opCodeOptions}
                                            />
                                        </div>

                                        {/* <div>
                                            {comparisonReport && comparisonData ? (
                                                <NonFilterablePerfCharts
                                                    chartData={comparisonData}
                                                    secondaryData={perfData}
                                                    maxCores={maxCores}
                                                    opCodeOptions={opCodeOptions}
                                                />
                                            ) : null}
                                        </div> */}
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
