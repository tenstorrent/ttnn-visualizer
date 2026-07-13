// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Marker, TypedPerfTableRow } from '../../definitions/PerfTable';
import { PERF_CHART_LABELS, PerfChartId } from '../../definitions/PerformanceCharts';
import PerfDurationHistogram from './PerfDurationHistogram';
import 'styles/components/PerfDurationHistogram.scss';

interface PerfOpDurationHistogramChartProps {
    rows: TypedPerfTableRow[];
    opCodeOptions: Marker[];
}

function PerfOpDurationHistogramChart({ rows, opCodeOptions }: PerfOpDurationHistogramChartProps) {
    return (
        <div
            className='perf-duration-histogram-chart'
            aria-label='Op duration distribution'
        >
            <PerfDurationHistogram
                id={PerfChartId.OpDurationHistogram}
                title={PERF_CHART_LABELS[PerfChartId.OpDurationHistogram]}
                rows={rows}
                opCodeOptions={opCodeOptions}
            />
        </div>
    );
}

export default PerfOpDurationHistogramChart;
