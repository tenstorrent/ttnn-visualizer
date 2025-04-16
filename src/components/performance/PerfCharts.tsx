import { FC, useEffect, useMemo, useState } from 'react';
import PerfDeviceKernelDurationChart from './PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from './PerfDeviceKernelRuntimeChart';
import PerfCoreCountUtilizationChart from './PerfCoreCountUtilizationChart';
import PerfOperationKernelUtilizationChart from './PerfOperationKernelUtilizationChart';
import PerfKernelDurationUtilizationChart from './PerfKernelDurationUtilizationChart';
import PerfOperationTypesChart from './PerfOperationTypesChart';
import PerfOpCountVsRuntimeChart from './PerfOpCountVsRuntimeChart';
import PerfChartFilter from './PerfChartFilter';
import { MARKER_COLOURS, Marker, PerfTableRow } from '../../definitions/PerfTable';
import 'styles/components/PerfCharts.scss';

interface PerfChartsProps {
    perfData: PerfTableRow[];
    maxCores: number;
}

const PerfCharts: FC<PerfChartsProps> = ({ perfData, maxCores }) => {
    const opCodeOptions = useMemo(
        () =>
            [
                ...new Set(
                    perfData?.map((row) => row.raw_op_code).filter((opCode): opCode is string => opCode !== undefined),
                ).values(),
            ]
                .sort()
                .map((opCode, index) => ({
                    opCode,
                    colour: MARKER_COLOURS[index],
                })),
        [perfData],
    );

    const [filteredPerfData, setFilteredPerfData] = useState<PerfTableRow[]>([]);
    const [selectedOpCodes, setSelectedOpCodes] = useState<Marker[]>(opCodeOptions);

    useEffect(() => {
        setFilteredPerfData(
            perfData
                ?.filter((row) =>
                    selectedOpCodes.length
                        ? selectedOpCodes.map((selected) => selected.opCode).includes(row.raw_op_code ?? '')
                        : false,
                )
                .sort((a, b) => (a.raw_op_code ?? '').localeCompare(b.raw_op_code ?? '')) || [],
        );
    }, [selectedOpCodes, perfData]);

    useEffect(() => {
        setSelectedOpCodes(opCodeOptions);
    }, [opCodeOptions]);

    return (
        <div className='charts-container'>
            <PerfChartFilter
                opCodeOptions={opCodeOptions}
                selectedOpCodes={selectedOpCodes}
                updateOpCodes={setSelectedOpCodes}
            />

            <div className='charts'>
                <PerfOpCountVsRuntimeChart
                    data={filteredPerfData}
                    selectedOpCodes={selectedOpCodes}
                />

                <PerfDeviceKernelRuntimeChart
                    data={filteredPerfData}
                    maxCores={maxCores}
                />

                <PerfDeviceKernelDurationChart data={filteredPerfData} />

                <PerfCoreCountUtilizationChart
                    data={filteredPerfData}
                    maxCores={maxCores}
                />

                <PerfOperationKernelUtilizationChart
                    data={filteredPerfData}
                    maxCores={maxCores}
                />

                <PerfKernelDurationUtilizationChart
                    data={filteredPerfData}
                    maxCores={maxCores}
                />

                <PerfOperationTypesChart
                    data={filteredPerfData}
                    opCodes={opCodeOptions}
                />
            </div>
        </div>
    );
};

export default PerfCharts;
