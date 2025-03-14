// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { Tab, TabId, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useDeviceLog, usePerformance, usePerformanceReport } from '../hooks/useAPI';
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
import { MARKER_COLOURS, Marker, RowData } from '../definitions/PerfTable';
import PerfChartFilter from '../components/performance/PerfChartFilter';

export default function Performance() {
    const { data: perfDataOld, isLoading: isLoadingPerformance } = usePerformance();
    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog();
    const { data: perfData } = usePerformanceReport();

    // TODO: Typing here is still a little weird
    const data = useMemo(
        () =>
            (perfDataOld?.data ? (perfDataOld.data as Partial<RowData>[]) : []).filter(
                (row) => row['OP TYPE'] === 'tt_dnn_device',
            ),
        [perfDataOld?.data],
    ) as RowData[];

    const opCodeOptions = useMemo(
        () =>
            [
                ...new Set(
                    data.map((row) => row['OP CODE']).filter((opCode): opCode is string => opCode !== undefined),
                ).values(),
            ]
                .sort()
                .map((opCode, index) => ({
                    opCode,
                    colour: MARKER_COLOURS[index],
                })),
        [data],
    );

    const [selectedTabId, setSelectedTabId] = useState<TabId>('tab-1');
    const [selectedOpCodes, setSelectedOpCodes] = useState<Marker[]>(opCodeOptions);
    const [filteredData, setFilteredData] = useState<RowData[]>([]);

    useClearSelectedBuffer();

    useEffect(() => {
        setSelectedOpCodes(opCodeOptions);
    }, [opCodeOptions]);

    useEffect(() => {
        setFilteredData(
            data
                .filter((row) =>
                    selectedOpCodes.length
                        ? selectedOpCodes.map((selected) => selected.opCode).includes(row['OP CODE'] ?? '')
                        : false,
                )
                .sort((a, b) => (a['OP CODE'] ?? '').localeCompare(b['OP CODE'] ?? '')),
        );
    }, [selectedOpCodes, data]);

    if (isLoadingPerformance || isLoadingDeviceLog) {
        return (
            <div className='centred-loader'>
                <LoadingSpinner />
            </div>
        );
    }

    const architecture = (deviceLog?.deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE) as DeviceArchitecture;
    const maxCores = getCoreCount(architecture, data);

    return (
        <div className='performance'>
            <Helmet title='Performance' />

            <h1 className='page-title'>Performance analysis</h1>

            <Tabs
                id='performance-tabs'
                selectedTabId={selectedTabId}
                onChange={setSelectedTabId}
                renderActiveTabPanelOnly
                size='large'
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
                                        data={filteredData}
                                        selectedOpCodes={selectedOpCodes}
                                    />

                                    <PerfDeviceKernelRuntimeChart
                                        data={filteredData}
                                        maxCores={maxCores}
                                    />

                                    <PerfDeviceKernelDurationChart data={filteredData} />

                                    <PerfCoreCountUtilizationChart
                                        data={filteredData}
                                        maxCores={maxCores}
                                    />

                                    <PerfOperationKernelUtilizationChart
                                        data={filteredData}
                                        maxCores={maxCores}
                                    />

                                    <PerfKernelDurationUtilizationChart
                                        data={filteredData}
                                        maxCores={maxCores}
                                    />

                                    <PerfOperationTypesChart
                                        data={data}
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
