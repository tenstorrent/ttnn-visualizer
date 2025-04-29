// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, useMemo } from 'react';
import PerfCoreCountUtilizationChart from './PerfCoreCountUtilizationChart';
import { Marker, PerfTableRow } from '../../definitions/PerfTable';
import PerfOperationTypesChart from './PerfOperationTypesChart';
import 'styles/components/PerfCharts.scss';
import DummyChart from './DummyChart';
import PerfOperationKernelUtilizationChart from './PerfOperationKernelUtilizationChart';
import PerfKernelDurationUtilizationChart from './PerfKernelDurationUtilizationChart';

interface NonFilterablePerfChartsProps {
    chartData: PerfTableRow[];
    secondaryData?: PerfTableRow[][];
    maxCores: number;
    opCodeOptions: Marker[];
}

const NonFilterablePerfCharts: FC<NonFilterablePerfChartsProps> = ({
    chartData,
    secondaryData = [],
    maxCores,
    opCodeOptions,
}) => {
    const datasets = [chartData, ...(secondaryData || [])].filter((set) => set.length > 0);

    const matmulData = useMemo(
        () => datasets.map((set) => set.filter((row) => row.raw_op_code.toLowerCase().includes('matmul'))),
        [datasets],
    );

    const convData = useMemo(
        () => datasets.map((set) => set.filter((row) => row.raw_op_code.toLowerCase().includes('conv'))),
        [datasets],
    );

    return (
        <div className='charts'>
            <h2>Matmul operations</h2>

            {matmulData.length > 0 ? (
                <>
                    <PerfCoreCountUtilizationChart
                        datasets={matmulData}
                        maxCores={maxCores}
                    />

                    <PerfOperationKernelUtilizationChart
                        datasets={matmulData}
                        maxCores={maxCores}
                    />

                    <PerfKernelDurationUtilizationChart
                        datasets={matmulData}
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

            <h2>Conv operations</h2>

            {convData.length > 0 ? (
                <>
                    <PerfCoreCountUtilizationChart
                        datasets={convData}
                        maxCores={maxCores}
                    />

                    <PerfOperationKernelUtilizationChart
                        datasets={convData}
                        maxCores={maxCores}
                    />

                    <PerfKernelDurationUtilizationChart
                        datasets={convData}
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

            <h2>All operations</h2>
            <PerfOperationTypesChart
                data={chartData}
                opCodes={opCodeOptions}
            />
        </div>
    );
};

export default NonFilterablePerfCharts;
