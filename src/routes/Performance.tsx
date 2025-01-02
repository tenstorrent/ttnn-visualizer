// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useState } from 'react';
import { Button, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { usePerformance } from '../hooks/useAPI';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import LoadingSpinner from '../components/LoadingSpinner';
import PerformanceOperationKernelUtilizationChart from '../components/PerformanceOperationKernelUtilizationChart';
import PerformanceOperationTypesChart from '../components/PerformanceOperationTypesChart';
import PerformanceScatterChart from '../components/PerformanceScatterChart';
import Overlay from '../components/Overlay';
import { PerformanceReport } from '../components/performance/PerfTable';
import 'styles/components/Performance.scss';

export default function Performance() {
    const [isOpen, setIsOpen] = useState(false);
    const { data: perfData, isLoading } = usePerformance();
    // const ops = useGetDeviceOperationsList();
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

            <header className='button-container'>
                <Button
                    text='View graphs'
                    icon={IconNames.GROUPED_BAR_CHART}
                    onClick={() => setIsOpen(true)}
                    disabled={!perfData?.data}
                    intent={Intent.PRIMARY}
                />
            </header>

            <Overlay
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
            >
                <h2>Matmul Operations</h2>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    {/* @ts-expect-error this should be just fine */}
                    <PerformanceOperationKernelUtilizationChart data={perfData?.data} />

                    {/* @ts-expect-error this should be just fine */}
                    <PerformanceScatterChart data={perfData?.data} />

                    {/* @ts-expect-error this should be just fine */}
                    <PerformanceOperationTypesChart data={perfData?.data} />
                </div>
            </Overlay>

            {/* @ts-expect-error this should be just fine */}
            <PerformanceReport data={perfData?.data} />
        </div>
    );
}
