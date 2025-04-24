// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, useMemo } from 'react';
import PerfCoreCountUtilizationChart from './PerfCoreCountUtilizationChart';
import PerfOperationKernelUtilizationChart from './PerfOperationKernelUtilizationChart';
import PerfKernelDurationUtilizationChart from './PerfKernelDurationUtilizationChart';
import { Marker, PerfTableRow } from '../../definitions/PerfTable';
import PerfOperationTypesChart from './PerfOperationTypesChart';
import 'styles/components/PerfCharts.scss';
import DummyChart from './DummyChart';

interface NonFilterablePerfChartsProps {
    chartData: PerfTableRow[];
    secondaryData?: PerfTableRow[];
    maxCores: number;
    opCodeOptions: Marker[];
}

const NonFilterablePerfCharts: FC<NonFilterablePerfChartsProps> = ({
    chartData,
    secondaryData = [],
    maxCores,
    opCodeOptions,
}) => {
    const matmulData = useMemo(
        () => chartData.filter((row) => row.raw_op_code.toLowerCase().includes('matmul')),
        [chartData],
    );

    const convData = useMemo(
        () => chartData.filter((row) => row.raw_op_code.toLowerCase().includes('conv')),
        [chartData],
    );

    const secondaryMatmulData = useMemo(
        () => secondaryData.filter((row) => row.raw_op_code.toLowerCase().includes('matmul')),
        [secondaryData],
    );

    const secondaryConvData = useMemo(
        () => secondaryData.filter((row) => row.raw_op_code.toLowerCase().includes('conv')),
        [secondaryData],
    );

    const hasMatmulData = matmulData.length > 0 || secondaryMatmulData.length > 0;
    const hasConvData = convData.length > 0 || secondaryConvData.length > 0;

    return (
        <div className='charts'>
            {hasMatmulData && (
                <>
                    <h2>Matmul operations</h2>

                    {matmulData.length > 0 ? (
                        <>
                            <PerfCoreCountUtilizationChart
                                data={matmulData}
                                maxCores={maxCores}
                            />

                            <PerfOperationKernelUtilizationChart
                                data={matmulData}
                                maxCores={maxCores}
                            />

                            <PerfKernelDurationUtilizationChart
                                data={matmulData}
                                maxCores={maxCores}
                            />
                        </>
                    ) : (
                        <>
                            <DummyChart />
                            <DummyChart />
                            <DummyChart />
                        </>
                    )}
                </>
            )}

            {hasConvData && (
                <>
                    <h2>Conv operations</h2>

                    {convData.length > 0 ? (
                        <>
                            <PerfCoreCountUtilizationChart
                                data={convData}
                                maxCores={maxCores}
                            />

                            <PerfOperationKernelUtilizationChart
                                data={convData}
                                maxCores={maxCores}
                            />

                            <PerfKernelDurationUtilizationChart
                                data={convData}
                                maxCores={maxCores}
                            />
                        </>
                    ) : (
                        <>
                            <DummyChart />
                            <DummyChart />
                            <DummyChart />
                        </>
                    )}
                </>
            )}

            <h2>All operations</h2>
            <PerfOperationTypesChart
                data={chartData}
                opCodes={opCodeOptions}
            />
        </div>
    );
};

export default NonFilterablePerfCharts;
