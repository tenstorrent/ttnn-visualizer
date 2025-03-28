// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { Size, Tab, TabId, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useDeviceLog, usePerformanceReport } from '../hooks/useAPI';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import LoadingSpinner from '../components/LoadingSpinner';
import PerformanceReport from '../components/performance/PerfReport';
import 'styles/components/Performance.scss';
import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import PerfDeviceKernelDurationChart from '../components/performance/PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from '../components/performance/PerfDeviceKernelRuntimeChart';
import PerfCoreCountUtilizationChart from '../components/performance/PerfCoreCountUtilizationChart';
import PerfOperationKernelUtilizationChart from '../components/performance/PerfOperationKernelUtilizationChart';
import PerfKernelDurationUtilizationChart from '../components/performance/PerfKernelDurationUtilizationChart';
import PerfOperationTypesChart from '../components/performance/PerfOperationTypesChart';
import PerfOpCountVsRuntimeChart from '../components/performance/PerfOpCountVsRuntimeChart';
import getCoreCount from '../functions/getCoreCount';
import { MARKER_COLOURS, Marker, PerfTableRow } from '../definitions/PerfTable';
import PerfChartFilter from '../components/performance/PerfChartFilter';

export default function Performance() {
    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog();
    const { data: perfData, isLoading: isLoadingPerformance } = usePerformanceReport();

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
    const [selectedOpCodes, setSelectedOpCodes] = useState<Marker[]>(opCodeOptions);
    const [filteredPerfData, setFilteredPerfData] = useState<PerfTableRow[]>([]);

    useClearSelectedBuffer();

    useEffect(() => {
        setSelectedOpCodes(opCodeOptions);
    }, [opCodeOptions]);

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

                            <div className='charts-container'>
                                <PerfChartFilter
                                    opCodeOptions={opCodeOptions}
                                    selectedOpCodes={selectedOpCodes}
                                    updateOpCodes={setSelectedOpCodes}
                                />

                                <div className='charts'>
                                    <PerfOpCountVsRuntimeChart
                                        data={filteredPerfData}
                                        selectedOpCodes={selectedOpCodes}
                                    />

                                    <PerfDeviceKernelRuntimeChart
                                        data={filteredPerfData}
                                        maxCores={maxCores}
                                    />

                                    <PerfDeviceKernelDurationChart data={filteredPerfData} />

                                    <PerfCoreCountUtilizationChart
                                        data={filteredPerfData}
                                        maxCores={maxCores}
                                    />

                                    <PerfOperationKernelUtilizationChart
                                        data={filteredPerfData}
                                        maxCores={maxCores}
                                    />

                                    <PerfKernelDurationUtilizationChart
                                        data={filteredPerfData}
                                        maxCores={maxCores}
                                    />

                                    <PerfOperationTypesChart
                                        data={filteredPerfData}
                                        opCodes={opCodeOptions}
                                    />
                                </div>
                            </div>
                        </div>
                    }
                />
            </Tabs>
        </div>
    );
}
