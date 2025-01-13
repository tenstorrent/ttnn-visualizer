// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useEffect, useMemo, useState } from 'react';
import { Button, ButtonGroup, Intent, Tab, TabId, Tabs } from '@blueprintjs/core';
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

    const data = useMemo(
        () => (perfData?.data ? (perfData.data as RowData[]) : []).filter((row) => row['OP TYPE'] === 'tt_dnn_device'),
        [perfData?.data],
    );

    const opCodeOptions = useMemo(
        () =>
            [
                ...new Set(
                    data.map((row) => row['OP CODE']).filter((opCode): opCode is string => opCode !== undefined),
                ).values(),
            ].sort(),
        [data],
    );

    const [selectedTabId, setSelectedTabId] = useState<TabId>('tab-1');
    const [selectedOpCodes, setSelectedOpCodes] = useState<string[]>(opCodeOptions);
    const [filteredData, setFilteredData] = useState<RowData[]>([]);

    useClearSelectedBuffer();

    useEffect(() => {
        setSelectedOpCodes(opCodeOptions);
    }, [opCodeOptions]);

    useEffect(() => {
        setFilteredData(
            data.filter((row) => (selectedOpCodes.length ? selectedOpCodes.includes(row['OP CODE'] ?? '') : false)),
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
                                <aside className='op-code-menu'>
                                    <p className='header'>
                                        <strong>Operation codes</strong>
                                    </p>

                                    {opCodeOptions.map((option) => (
                                        <label
                                            className='option'
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

                                    <ButtonGroup
                                        className='footer'
                                        outlined
                                    >
                                        <Button
                                            onClick={() => setSelectedOpCodes(opCodeOptions)}
                                            intent={Intent.PRIMARY}
                                        >
                                            Select all
                                        </Button>
                                        <Button
                                            onClick={() => setSelectedOpCodes([])}
                                            intent={Intent.DANGER}
                                        >
                                            Clear all
                                        </Button>
                                    </ButtonGroup>
                                </aside>

                                <div className='charts'>
                                    {/* <ul>
                                        <li>
                                            <a href='#device-kernel-duration'>Device kernel duration</a>
                                        </li>
                                    </ul> */}

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

                                    <PerfOperationTypesChart data={data} />
                                </div>
                            </div>
                        </div>
                    }
                />
            </Tabs>
        </div>
    );
}
