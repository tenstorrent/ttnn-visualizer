// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import PerfCoreCountUtilizationChart from './PerfCoreCountUtilizationChart';
import { Marker, PerfTableRow } from '../../definitions/PerfTable';
import PerfOperationTypesChart from './PerfOperationTypesChart';
import SkeletalChart from './SkeletalChart';
import PerfOperationKernelUtilizationChart from './PerfOperationKernelUtilizationChart';
import PerfKernelDurationUtilizationChart from './PerfKernelDurationUtilizationChart';
import 'styles/components/PerfCharts.scss';
import { activePerformanceReportAtom, comparisonPerformanceReportAtom } from '../../store/app';
import PerfDeviceTimeChart from './PerfDeviceTimeChart';

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
    const performanceReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReports = useAtomValue(comparisonPerformanceReportAtom);

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

            {matmulData.filter((data) => data.length).length > 0 ? (
                <>
                    <PerfCoreCountUtilizationChart
                        datasets={matmulData}
                        maxCores={maxCores}
                    />

                    <PerfDeviceTimeChart datasets={matmulData} />

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
                <SkeletalChart />
            )}

            <h2>Conv operations</h2>

            {convData.filter((data) => data.length).length > 0 ? (
                <>
                    <PerfCoreCountUtilizationChart
                        datasets={convData}
                        maxCores={maxCores}
                    />

                    <PerfDeviceTimeChart datasets={convData} />

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
                <SkeletalChart />
            )}

            <h2>All operations</h2>
            <div className='operation-types-charts'>
                {performanceReport && (
                    <PerfOperationTypesChart
                        className='flex-chart'
                        reportTitle={comparisonReports ? performanceReport : ''}
                        data={chartData}
                        opCodes={opCodeOptions}
                    />
                )}

                {comparisonReports?.map((report, index) => (
                    <PerfOperationTypesChart
                        key={`${report}-${index}`}
                        className='flex-chart'
                        reportTitle={performanceReport ? report : ''}
                        data={secondaryData[index]}
                        opCodes={opCodeOptions}
                    />
                ))}
            </div>
        </div>
    );
};

export default NonFilterablePerfCharts;
