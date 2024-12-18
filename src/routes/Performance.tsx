// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { usePerformance, useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../store/app';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import PerformanceScatterChart from '../components/PerformanceScatterChart';
import { PerformanceReport } from '../components/performance/PerfTable';
import LoadingSpinner from '../components/LoadingSpinner';

export default function Performance() {
    const report = useReportMeta();
    const setMeta = useSetAtom(reportMetaAtom);
    const { data: perfData, isLoading } = usePerformance();
    // const ops = useGetDeviceOperationsList();
    useClearSelectedBuffer();

    // Needs to be in a useEffect to avoid a bad setState call
    useEffect(() => {
        if (report.status === 'success' && report.data) {
            setMeta(report.data);
        }
    }, [report, setMeta]);

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
