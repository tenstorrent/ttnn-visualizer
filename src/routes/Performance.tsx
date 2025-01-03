// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useState } from 'react';
import { Tab, TabId, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { usePerformance } from '../hooks/useAPI';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import LoadingSpinner from '../components/LoadingSpinner';
import PerformanceOperationKernelUtilizationChart from '../components/PerformanceOperationKernelUtilizationChart';
import PerformanceOperationTypesChart from '../components/PerformanceOperationTypesChart';
import PerformanceScatterChart from '../components/PerformanceScatterChart';
import { PerformanceReport } from '../components/performance/PerfTable';
import 'styles/components/Performance.scss';

export default function Performance() {
    const { data: perfData, isLoading } = usePerformance();
    const [selectedTabId, setSelectedTabId] = useState<TabId>('tab-2');
    useClearSelectedBuffer();

    if (isLoading) {
        return (
            <div className='centered-loader'>
                <LoadingSpinner />
            </div>
        );
    }

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
                            {/* @ts-expect-error this should be just fine */}
                            <PerformanceOperationKernelUtilizationChart data={perfData?.data} />

                            {/* @ts-expect-error this should be just fine */}
                            <PerformanceScatterChart data={perfData?.data} />

                            {/* @ts-expect-error this should be just fine */}
                            <PerformanceOperationTypesChart data={perfData?.data} />
                        </div>
                    }
                />
            </Tabs>
        </div>
    );
}
