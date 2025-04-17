// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { Button, ButtonVariant, Size, Tab, TabId, Tabs } from '@blueprintjs/core';
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

export default function Performance() {
    const [comparisonReport, setComparisonReport] = useAtom(comparisonPerformanceReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog();
    const { data: perfData, isLoading: isLoadingPerformance } = usePerformanceReport();
    const { data: comparisonData } = usePerformanceComparisonReport(comparisonReport);
    const { data: folderList } = usePerfFolderList();

    useClearSelectedBuffer();

    const opCodeOptions = useMemo(
        () =>
            [
                ...new Set(
                    perfData?.map((row) => row.raw_op_code).filter((opCode): opCode is string => opCode !== undefined),
                ).values(),
            ]
                .sort()
                .map((opCode, index) => ({
                    opCode,
                    colour: MARKER_COLOURS[index],
                })),
        [perfData],
    );

    const [selectedTabId, setSelectedTabId] = useState<TabId>('tab-1');
    const [filteredPerfData, setFilteredPerfData] = useState<PerfTableRow[]>([]);
    const [filteredComparisonData, setFilteredComparisonData] = useState<PerfTableRow[]>([]);
    const [selectedOpCodes, setSelectedOpCodes] = useState<Marker[]>(opCodeOptions);

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

                            {folderList ? (
                                <div className='folder-selection'>
                                    <LocalFolderPicker
                                        items={folderList.filter(
                                            (folder: string) => folder !== activePerformanceReport,
                                        )}
                                        value={comparisonReport}
                                        handleSelect={(value) => setComparisonReport(value)}
                                    />

                                    <Button
                                        variant={ButtonVariant.OUTLINED}
                                        icon={IconNames.CROSS}
                                        onClick={() => setComparisonReport(null)}
                                    />
                                </div>
                            ) : (
                                <LoadingSpinner />
                            )}

                            {perfData ? (
                                <div className='charts-container'>
                                    <PerfChartFilter
                                        opCodeOptions={opCodeOptions}
                                        selectedOpCodes={selectedOpCodes}
                                        updateOpCodes={setSelectedOpCodes}
                                    />

                                    <PerfCharts
                                        perfData={filteredPerfData}
                                        maxCores={maxCores}
                                        opCodeOptions={opCodeOptions}
                                        selectedOpCodes={selectedOpCodes}
                                        title={comparisonData && activePerformanceReport}
                                    />

                                    {comparisonReport ? (
                                        <PerfCharts
                                            perfData={filteredComparisonData}
                                            maxCores={maxCores}
                                            opCodeOptions={opCodeOptions}
                                            selectedOpCodes={selectedOpCodes}
                                            title={comparisonReport}
                                        />
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    }
                />
            </Tabs>
        </div>
    );
}
