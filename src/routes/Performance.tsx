// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { Button, Size, Tab, TabId, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom, useAtomValue } from 'jotai';
import classNames from 'classnames';
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
    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog();
    const { data: perfData, isLoading: isLoadingPerformance } = usePerformanceReport();
    const { data: folderList } = usePerfFolderList();

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
    const [selectedOpCodes, setSelectedOpCodes] = useState<Marker[]>(opCodeOptions);

    const [comparisonReport, setComparisonReport] = useAtom(comparisonPerformanceReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const { data: comparisonData } = usePerformanceComparisonReport(comparisonReport);

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

    useClearSelectedBuffer();

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
                                <>
                                    <LocalFolderPicker
                                        items={folderList.filter(
                                            (folder: string) => folder !== activePerformanceReport,
                                        )}
                                        value={comparisonReport}
                                        handleSelect={(value) => setComparisonReport(value)}
                                    />

                                    {comparisonReport && <p>Comparison: {comparisonData?.length ?? 'None'}</p>}

                                    <Button
                                        icon={IconNames.CROSS}
                                        onClick={() => setComparisonReport(null)}
                                    />
                                </>
                            ) : (
                                <LoadingSpinner />
                            )}

                            {perfData ? (
                                <div className={classNames('charts-container', { 'has-comparison': comparisonData })}>
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

                                    {comparisonData ? (
                                        <PerfCharts
                                            perfData={comparisonData}
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
