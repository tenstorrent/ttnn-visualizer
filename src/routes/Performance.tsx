// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useState } from 'react';
import { Tab, TabId, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useDeviceLog, usePerformance } from '../hooks/useAPI';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import LoadingSpinner from '../components/LoadingSpinner';
import PerformanceOperationKernelUtilizationChart from '../components/PerformanceOperationKernelUtilizationChart';
import PerformanceOperationTypesChart from '../components/PerformanceOperationTypesChart';
import { PerformanceReport } from '../components/performance/PerfTable';
import 'styles/components/Performance.scss';
import { DeviceArchitecture } from '../model/APIData';
import PerfCoreCountUtilizationChart from '../components/PerfCoreCountUtilizationChart';
import PerformanceDeviceKernelRuntimeChart from '../components/PerformanceDeviceKernelRuntimeChart';
import PerformanceKernelDurationUtilizationChart from '../components/PerformanceKernelDurationUtilizationChart';
import PerfDeviceKernelDurationChart from '../components/PerfDeviceKernelDurationChart';

export default function Performance() {
    const { data: perfData, isLoading: isLoadingPerformance } = usePerformance();
    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog();
    const [selectedTabId, setSelectedTabId] = useState<TabId>('tab-2');
    useClearSelectedBuffer();

    if (isLoadingPerformance || isLoadingDeviceLog) {
        return (
            <div className='centered-loader'>
                <LoadingSpinner />
            </div>
        );
    }

    const architecture = (deviceLog?.deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE) as DeviceArchitecture;

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
                    // @ts-expect-error this should be just fine
                    panel={<PerformanceReport data={perfData?.data} />}
                />

                <Tab
                    id='tab-2'
                    title='Graphs'
                    icon={IconNames.TIMELINE_AREA_CHART}
                    panel={
                        <div className='graph-container'>
                            <PerfDeviceKernelDurationChart
                                // @ts-expect-error this should be just fine
                                data={perfData?.data}
                            />

                            <PerformanceDeviceKernelRuntimeChart
                                // @ts-expect-error this should be just fine
                                data={perfData?.data}
                            />

                            {/* Please note we want to change this so we selectively render the below charts with different sets of data */}
                            <h2>MatMul Operations</h2>

                            <PerfCoreCountUtilizationChart
                                // @ts-expect-error this should be just fine
                                data={perfData?.data}
                                architecture={architecture}
                            />

                            <PerformanceOperationKernelUtilizationChart
                                // @ts-expect-error this should be just fine
                                data={perfData?.data}
                                architecture={architecture}
                            />

                            <PerformanceKernelDurationUtilizationChart
                                // @ts-expect-error this should be just fine
                                data={perfData?.data}
                                architecture={architecture}
                            />

                            {/* @ts-expect-error this should be just fine */}
                            <PerformanceOperationTypesChart data={perfData?.data} />
                        </div>
                    }
                />
            </Tabs>
        </div>
    );
}
