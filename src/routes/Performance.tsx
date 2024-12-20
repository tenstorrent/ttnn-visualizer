// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { usePerformance } from '../hooks/useAPI';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import PerformanceScatterChart from '../components/PerformanceScatterChart';
import { PerformanceReport } from '../components/performance/PerfTable';
import LoadingSpinner from '../components/LoadingSpinner';

export default function Performance() {
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
        <>
            <Helmet title='Performance' />

            {/* @ts-expect-error this should be just fine */}
            <PerformanceReport data={perfData?.data} />

            {/* @ts-expect-error this should be just fine */}
            <PerformanceScatterChart data={perfData?.data} />
        </>
    );
}
