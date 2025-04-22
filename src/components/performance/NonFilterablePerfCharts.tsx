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

interface NonFilterablePerfChartsProps {
    perfData: PerfTableRow[];
    maxCores: number;
    opCodeOptions: Marker[];
    hasComparison?: boolean;
}

const NonFilterablePerfCharts: FC<NonFilterablePerfChartsProps> = ({
    perfData,
    maxCores,
    opCodeOptions,
    hasComparison,
}) => {
    const matmulData = useMemo(
        () => perfData.filter((row) => row.raw_op_code.toLowerCase().includes('matmul')),
        [perfData],
    );

    const convData = useMemo(
        () => perfData.filter((row) => row.raw_op_code.toLowerCase().includes('conv')),
        [perfData],
    );

    return (
        <div className='charts'>
            {hasComparison && matmulData.length > 0 ? (
                <>
                    <h2>Matmul operations</h2>

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
            ) : null}

            {hasComparison && !matmulData ? (
                <>
                    <div className='chart-container dummy-outline' />
                    <div className='chart-container dummy-outline' />
                    <div className='chart-container dummy-outline' />
                </>
            ) : null}

            {hasComparison && convData.length > 0 ? (
                <>
                    <h2>Conv operations</h2>

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
            ) : null}

            {hasComparison && !convData ? (
                <>
                    <div className='chart-container dummy-outline' />
                    <div className='chart-container dummy-outline' />
                    <div className='chart-container dummy-outline' />
                </>
            ) : null}

            <h2>All operations</h2>

            <PerfOperationTypesChart
                data={perfData}
                opCodes={opCodeOptions}
            />
        </div>
    );
};

export default NonFilterablePerfCharts;
