// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { formatDuration } from '../../functions/formatting';
import 'styles/components/PerfOverlay.scss';

interface PerfOverlayOpMetricProps {
    perfDeviceTimeNs?: number;
    /** Same colour the node is rendered with on the graph. */
    perfColor?: string;
}

const PerfOverlayOpMetric = ({ perfDeviceTimeNs, perfColor }: PerfOverlayOpMetricProps) => (
    <div className='perf-overlay-op-metric'>
        <span className='perf-overlay-op-metric-label'>Kernel duration</span>
        <span className='perf-overlay-op-metric-value'>
            {perfColor && perfDeviceTimeNs !== undefined && (
                <span
                    className='perf-overlay-op-metric-swatch'
                    style={{ backgroundColor: perfColor }}
                    aria-hidden='true'
                />
            )}
            {perfDeviceTimeNs !== undefined ? formatDuration(perfDeviceTimeNs) : 'No perf data'}
        </span>
    </div>
);

export default PerfOverlayOpMetric;
