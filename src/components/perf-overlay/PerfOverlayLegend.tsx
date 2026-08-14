// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { formatDuration } from '../../functions/formatting';
import { PERF_GRADIENT_CSS } from '../../functions/perfOverlay';
import 'styles/components/PerfOverlay.scss';

interface PerfOverlayLegendProps {
    minNs: number;
    maxNs: number;
}

const PerfOverlayLegend = ({ minNs, maxNs }: PerfOverlayLegendProps) => (
    <div
        className='perf-overlay-legend'
        aria-label='Perf overlay legend'
    >
        <div className='perf-overlay-legend-title'>Kernel duration (log)</div>
        <div
            className='perf-overlay-legend-gradient'
            style={{ background: PERF_GRADIENT_CSS }}
            aria-hidden='true'
        />
        <div className='perf-overlay-legend-bounds'>
            <span>{formatDuration(minNs)}</span>
            <span>{formatDuration(maxNs)}</span>
        </div>
    </div>
);

export default PerfOverlayLegend;
