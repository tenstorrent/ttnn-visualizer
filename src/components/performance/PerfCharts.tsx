// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC } from 'react';
import PerfDeviceKernelDurationChart from './PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from './PerfDeviceKernelRuntimeChart';
import PerfOpCountVsRuntimeChart from './PerfOpCountVsRuntimeChart';
import { Marker, PerfTableRow } from '../../definitions/PerfTable';
import 'styles/components/PerfCharts.scss';

interface PerfChartsProps {
    filteredPerfData: PerfTableRow[];
    maxCores: number;
    selectedOpCodes: Marker[];
    title?: string | null;
}

const PerfCharts: FC<PerfChartsProps> = ({ filteredPerfData, maxCores, selectedOpCodes, title }) => {
    return (
        <div className='charts'>
            {title ? <h2>{title}</h2> : null}

            <PerfOpCountVsRuntimeChart
                data={filteredPerfData}
                selectedOpCodes={selectedOpCodes}
            />

            <PerfDeviceKernelRuntimeChart
                data={filteredPerfData}
                maxCores={maxCores}
            />

            <PerfDeviceKernelDurationChart data={filteredPerfData} />
        </div>
    );
};

export default PerfCharts;
