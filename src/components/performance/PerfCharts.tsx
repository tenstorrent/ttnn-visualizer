// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC } from 'react';
import PerfDeviceKernelDurationChart from './PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from './PerfDeviceKernelRuntimeChart';
import PerfOpCountVsRuntimeChart from './PerfOpCountVsRuntimeChart';
import { Marker, PerfTableRow } from '../../definitions/PerfTable';
import 'styles/components/PerfCharts.scss';

interface PerfChartsProps {
    filteredPerfData: PerfTableRow[];
    comparisonData?: PerfTableRow[][];
    selectedOpCodes: Marker[];
}

const PerfCharts: FC<PerfChartsProps> = ({ filteredPerfData, comparisonData, selectedOpCodes }) => {
    const data = [filteredPerfData, ...(comparisonData || [])].filter((set) => set.length > 0);

    return (
        <div className='charts'>
            <PerfOpCountVsRuntimeChart
                datasets={data}
                selectedOpCodes={selectedOpCodes}
            />

            <PerfDeviceKernelRuntimeChart datasets={data} />

            <PerfDeviceKernelDurationChart datasets={data} />
        </div>
    );
};

export default PerfCharts;
