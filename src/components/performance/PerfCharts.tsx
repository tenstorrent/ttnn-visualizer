// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import PerfDeviceKernelDurationChart from './PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from './PerfDeviceKernelRuntimeChart';
import PerfOpCountVsRuntimeChart from './PerfOpCountVsRuntimeChart';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';

interface PerfChartsProps {
    filteredPerfData: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    selectedOpCodes: Marker[];
}

const PerfCharts = ({ filteredPerfData, comparisonData, selectedOpCodes }: PerfChartsProps) => {
    const data = [filteredPerfData, ...(comparisonData || [])].filter((set) => set.length > 0);

    return (
        <>
            <PerfOpCountVsRuntimeChart
                datasets={data}
                selectedOpCodes={selectedOpCodes}
            />

            <PerfDeviceKernelRuntimeChart datasets={data} />

            <PerfDeviceKernelDurationChart datasets={data} />
        </>
    );
};

export default PerfCharts;
