// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useState } from 'react';
import { Tab, TabId, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useDeviceLog, usePerformance } from '../hooks/useAPI';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import LoadingSpinner from '../components/LoadingSpinner';
import { PerformanceReport } from '../components/performance/PerfTable';
import 'styles/components/Performance.scss';
import { DeviceArchitecture } from '../model/APIData';
import PerfDeviceKernelDurationChart from '../components/performance/PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from '../components/performance/PerfDeviceKernelRuntimeChart';
import PerfCoreCountUtilizationChart from '../components/performance/PerfCoreCountUtilizationChart';
import PerfOperationKernelUtilizationChart from '../components/performance/PerfOperationKernelUtilizationChart';
import PerfKernelDurationUtilizationChart from '../components/performance/PerfKernelDurationUtilizationChart';
import PerfOperationTypesChart from '../components/performance/PerfOperationTypesChart';
import getCoreCount from '../functions/getCoreCount';
import { RowData } from '../definitions/PerfTable';

export default function Performance() {
    const { data: perfData, isLoading: isLoadingPerformance } = usePerformance();
    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog();
    const [selectedTabId, setSelectedTabId] = useState<TabId>('tab-1');
    const [selectedOpCodes, setSelectedOpCodes] = useState<string[]>([]);
    const [_filteredData, setFilteredData] = useState<RowData[]>([]);

    useClearSelectedBuffer();

    const data = (perfData?.data ? (perfData.data as RowData[]) : []).filter(
        (row) => row['OP TYPE'] === 'tt_dnn_device',
    );

    const opCodeOptions = new Set(
        data.map((row) => row['OP CODE']).filter((opCode): opCode is string => opCode !== undefined),
    );

    useEffect(() => {
        setFilteredData(
            data.filter((row) => (selectedOpCodes.length ? selectedOpCodes.includes(row['OP CODE'] ?? '') : row)),
        );
    }, [selectedOpCodes, data]);

    if (isLoadingPerformance || isLoadingDeviceLog) {
        return (
            <div className='centered-loader'>
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

            <p>
                {architecture} ({maxCores} cores)
            </p>

            <p>{opCodeOptions.entries()}</p>

            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', flexDirection: 'column' }}>
                Selected: {selectedOpCodes}
                {[...opCodeOptions.values()].map((option) => (
                    <label
                        style={{ display: 'flex', gap: '5px' }}
                        key={option}
                        htmlFor={option}
                    >
                        <input
                            type='checkbox'
                            checked={selectedOpCodes.includes(option)}
                            id={option}
                            onChange={() =>
                                setSelectedOpCodes((currentCodes) =>
                                    currentCodes.includes(option)
                                        ? currentCodes.filter((code) => code !== option)
                                        : [...currentCodes, option],
                                )
                            }
                        />
                        <span>{option}</span>
                    </label>
                ))}
            </div>

            <Tabs
                id='performance-tabs'
                selectedTabId={selectedTabId}
                onChange={setSelectedTabId}
                renderActiveTabPanelOnly
                large
            >
                <Tab
                    id='tab-1'
                    title='Table'
                    icon={IconNames.TH}
                    panel={<PerformanceReport data={data} />}
                />

                <Tab
                    id='tab-2'
                    title='Graphs'
                    icon={IconNames.TIMELINE_AREA_CHART}
                    panel={
                        <div className='graph-tab'>
                            <PerfDeviceKernelDurationChart data={data} />

                            <PerfDeviceKernelRuntimeChart data={data} />

                            {/* Please note we want to change this so we selectively render the below charts with different sets of data */}
                            <h2>MatMul Operations</h2>

                            <PerfCoreCountUtilizationChart
                                data={data}
                                maxCores={maxCores}
                            />

                            <PerfOperationKernelUtilizationChart
                                data={data}
                                maxCores={maxCores}
                            />

                            <PerfKernelDurationUtilizationChart
                                data={data}
                                maxCores={maxCores}
                            />

                            <PerfOperationTypesChart data={data} />
                        </div>
                    }
                />
            </Tabs>
        </div>
    );
}
