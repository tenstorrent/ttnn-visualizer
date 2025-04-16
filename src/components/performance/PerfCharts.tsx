import { FC } from 'react';
import PerfDeviceKernelDurationChart from './PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from './PerfDeviceKernelRuntimeChart';
import PerfCoreCountUtilizationChart from './PerfCoreCountUtilizationChart';
import PerfOperationKernelUtilizationChart from './PerfOperationKernelUtilizationChart';
import PerfKernelDurationUtilizationChart from './PerfKernelDurationUtilizationChart';
import PerfOperationTypesChart from './PerfOperationTypesChart';
import PerfOpCountVsRuntimeChart from './PerfOpCountVsRuntimeChart';
import { Marker, PerfTableRow } from '../../definitions/PerfTable';
import 'styles/components/PerfCharts.scss';

interface PerfChartsProps {
    perfData: PerfTableRow[];
    maxCores: number;
    opCodeOptions: Marker[];
    selectedOpCodes: Marker[];
}

const PerfCharts: FC<PerfChartsProps> = ({ perfData, maxCores, opCodeOptions, selectedOpCodes }) => {
    return (
        <div className='charts'>
            <PerfOpCountVsRuntimeChart
                data={perfData}
                selectedOpCodes={selectedOpCodes}
            />

            <PerfDeviceKernelRuntimeChart
                data={perfData}
                maxCores={maxCores}
            />

            <PerfDeviceKernelDurationChart data={perfData} />

            <PerfCoreCountUtilizationChart
                data={perfData}
                maxCores={maxCores}
            />

            <PerfOperationKernelUtilizationChart
                data={perfData}
                maxCores={maxCores}
            />

            <PerfKernelDurationUtilizationChart
                data={perfData}
                maxCores={maxCores}
            />

            <PerfOperationTypesChart
                data={perfData}
                opCodes={opCodeOptions}
            />
        </div>
    );
};

export default PerfCharts;
