// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import PerfCoreCountUtilizationChart from './PerfCoreCountUtilizationChart';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import PerfOperationTypesChart from './PerfOperationTypesChart';
import SkeletalChart from './SkeletalChart';
import PerfOperationKernelUtilizationChart from './PerfOperationKernelUtilizationChart';
import PerfKernelDurationUtilizationChart from './PerfKernelDurationUtilizationChart';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../../store/app';
import PerfDeviceTimeChart from './PerfDeviceTimeChart';
import getCoreCount from '../../functions/getCoreCount';
import { DeviceArchitecture } from '../../definitions/DeviceArchitecture';
import { usePerfMeta } from '../../hooks/useAPI';
import { PerfChartId, getOperationTypesChartId } from '../../definitions/PerformanceCharts';

interface NonFilterablePerfChartsProps {
    chartData: TypedPerfTableRow[];
    secondaryData?: TypedPerfTableRow[][];
    opCodeOptions: Marker[];
    matmulData: TypedPerfTableRow[][];
    convData: TypedPerfTableRow[][];
    hasMatmulData: boolean;
    hasConvData: boolean;
}

const NonFilterablePerfCharts = ({
    chartData,
    secondaryData = [],
    opCodeOptions,
    matmulData,
    convData,
    hasMatmulData,
    hasConvData,
}: NonFilterablePerfChartsProps) => {
    const performanceReport = useAtomValue(activePerformanceReportAtom);
    const comparisonReportList = useAtomValue(comparisonPerformanceReportListAtom);

    const { data: deviceMeta } = usePerfMeta();

    const datasets = [chartData, ...(secondaryData || [])].filter((set) => set.length > 0);
    const architecture = deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE;
    const maxCores = getCoreCount(architecture, datasets[0] ?? []);

    return (
        <>
            <h2>Matmul operations</h2>

            {hasMatmulData ? (
                <>
                    <PerfCoreCountUtilizationChart
                        datasets={matmulData}
                        maxCores={maxCores}
                        chartId={PerfChartId.MatmulCoreCountUtilization}
                    />

                    <PerfDeviceTimeChart
                        datasets={matmulData}
                        chartId={PerfChartId.MatmulDeviceTime}
                    />

                    <PerfOperationKernelUtilizationChart
                        datasets={matmulData}
                        maxCores={maxCores}
                        chartId={PerfChartId.MatmulKernelDurationUtilization}
                    />

                    <PerfKernelDurationUtilizationChart
                        datasets={matmulData}
                        maxCores={maxCores}
                        chartId={PerfChartId.MatmulUtilizationVsKernelDuration}
                    />
                </>
            ) : (
                <SkeletalChart />
            )}

            <h2>Conv operations</h2>

            {hasConvData ? (
                <>
                    <PerfCoreCountUtilizationChart
                        datasets={convData}
                        maxCores={maxCores}
                        chartId={PerfChartId.ConvCoreCountUtilization}
                    />

                    <PerfDeviceTimeChart
                        datasets={convData}
                        chartId={PerfChartId.ConvDeviceTime}
                    />

                    <PerfOperationKernelUtilizationChart
                        datasets={convData}
                        maxCores={maxCores}
                        chartId={PerfChartId.ConvKernelDurationUtilization}
                    />

                    <PerfKernelDurationUtilizationChart
                        datasets={convData}
                        maxCores={maxCores}
                        chartId={PerfChartId.ConvUtilizationVsKernelDuration}
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
                        id={getOperationTypesChartId('active')}
                    />
                )}

                {comparisonReportList?.map((report, index) => (
                    <PerfOperationTypesChart
                        key={`${report}-${index}`}
                        className='flex-chart'
                        reportTitle={performanceReport ? report : ''}
                        data={secondaryData[index]}
                        opCodes={opCodeOptions}
                        id={getOperationTypesChartId(`comparison-${index}`)}
                    />
                ))}
            </div>
        </>
    );
};

export default NonFilterablePerfCharts;
