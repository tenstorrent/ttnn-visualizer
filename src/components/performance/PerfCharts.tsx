// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import PerfDeviceKernelDurationChart from './PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from './PerfDeviceKernelRuntimeChart';
import PerfL1PressureChart from './PerfL1PressureChart';
import PerfOpCountVsRuntimeChart from './PerfOpCountVsRuntimeChart';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import 'styles/components/PerfCharts.scss';

interface PerfChartsProps {
    filteredPerfData: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    selectedOpCodes: Marker[];
    hasL1PressureData?: boolean;
}

const PerfCharts = ({
    filteredPerfData,
    comparisonData,
    selectedOpCodes,
    hasL1PressureData = false,
}: PerfChartsProps) => {
    const data = [filteredPerfData, ...(comparisonData || [])].filter((set) => set.length > 0);

    return (
        <div className='charts'>
            <PerfOpCountVsRuntimeChart
                datasets={data}
                selectedOpCodes={selectedOpCodes}
            />

            <PerfDeviceKernelRuntimeChart datasets={data} />

            <PerfDeviceKernelDurationChart datasets={data} />

            {hasL1PressureData ? <PerfL1PressureChart datasets={data} /> : null}
        </div>
    );
};

export default PerfCharts;
