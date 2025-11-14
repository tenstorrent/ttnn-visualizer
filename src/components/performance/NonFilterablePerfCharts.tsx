// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import PerfCoreCountUtilizationChart from './PerfCoreCountUtilizationChart';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import PerfOperationTypesChart from './PerfOperationTypesChart';
import SkeletalChart from './SkeletalChart';
import PerfOperationKernelUtilizationChart from './PerfOperationKernelUtilizationChart';
import PerfKernelDurationUtilizationChart from './PerfKernelDurationUtilizationChart';
import 'styles/components/PerfCharts.scss';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import PerfDeviceTimeChart from './PerfDeviceTimeChart';
import getCoreCount from '../../functions/getCoreCount';
import { DeviceArchitecture } from '../../definitions/DeviceArchitecture';
import { useDeviceLog } from '../../hooks/useAPI';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';

interface NonFilterablePerfChartsProps {
    chartData: TypedPerfTableRow[];
    secondaryData?: TypedPerfTableRow[][];
    opCodeOptions: Marker[];
}

const NonFilterablePerfCharts: FC<NonFilterablePerfChartsProps> = ({
    chartData,
    secondaryData = [],
    opCodeOptions,
}) => {
    const performanceReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);

    const { data: deviceLog } = useDeviceLog();

    const datasets = [chartData, ...(secondaryData || [])].filter((set) => set.length > 0);
    const architecture = deviceLog?.deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE;
    const maxCores = getCoreCount(architecture, datasets[0] ?? []);

    const matmulData = useMemo(
        () => datasets.map((set) => set.filter((row) => row.raw_op_code.toLowerCase().includes('matmul'))),
        [datasets],
    );

    const convData = useMemo(
        () => datasets.map((set) => set.filter((row) => row.raw_op_code.toLowerCase().includes('conv'))),
        [datasets],
    );

    const isMultiDevice = useMemo(() => {
        return datasets.some((dataset) => new Set(dataset.map((row) => row.device)).size > 1);
    }, [datasets]);

    const MultiDeviceNotice = isMultiDevice ? <PerfMultiDeviceNotice /> : null;

    return (
        <div className='charts'>
            <h2>Matmul operations</h2>

            {matmulData.filter((data) => data.length).length > 0 ? (
                <>
                    {MultiDeviceNotice}
                    <PerfCoreCountUtilizationChart
                        datasets={matmulData}
                        maxCores={maxCores}
                    />

                    <PerfDeviceTimeChart datasets={matmulData} />

                    {MultiDeviceNotice}
                    <PerfOperationKernelUtilizationChart
                        datasets={matmulData}
                        maxCores={maxCores}
                    />

                    {MultiDeviceNotice}
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
                        reportTitle={comparisonReportList ? performanceReport.reportName : ''}
                        data={chartData}
                        opCodes={opCodeOptions}
                    />
                )}

                {comparisonReportList?.map((report, index) => (
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
