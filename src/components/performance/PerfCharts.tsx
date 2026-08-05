// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import PerfDurationHistogram from './PerfDurationHistogram';
import PerfDeviceKernelDurationChart from './PerfDeviceKernelDurationChart';
import PerfDeviceKernelRuntimeChart from './PerfDeviceKernelRuntimeChart';
import PerfOpCountVsRuntimeChart from './PerfOpCountVsRuntimeChart';
import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import { OnOpCodeClick, PERF_CHART_GROUP_LABELS, PerfChartGroup } from '../../definitions/PerformanceCharts';

interface PerfChartsProps {
    filteredPerfData: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    selectedOpCodes: Marker[];
    onOpCodeClick?: OnOpCodeClick;
}

const PerfCharts = ({ filteredPerfData, comparisonData, selectedOpCodes, onOpCodeClick }: PerfChartsProps) => {
    const data = [filteredPerfData, ...(comparisonData || [])].filter((set) => set.length > 0);
    const hasComparisonReports = Boolean(comparisonData?.some((set) => set.length > 0));

    return (
        <>
            <h2>{PERF_CHART_GROUP_LABELS[PerfChartGroup.ALL]}</h2>

            <PerfDurationHistogram
                rows={filteredPerfData}
                selectedOpCodes={selectedOpCodes}
                onOpCodeClick={onOpCodeClick}
                hasComparisonReports={hasComparisonReports}
            />

            <PerfOpCountVsRuntimeChart
                datasets={data}
                selectedOpCodes={selectedOpCodes}
                onOpCodeClick={onOpCodeClick}
            />

            <PerfDeviceKernelRuntimeChart datasets={data} />

            <PerfDeviceKernelDurationChart datasets={data} />
        </>
    );
};

export default PerfCharts;
