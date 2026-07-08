// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PERF_CHART_TABLE_FILTER_HINT } from '../../definitions/PerformanceCharts';
import { TEST_IDS } from '../../definitions/TestIds';
import 'styles/components/PerfChartFilterHint.scss';

interface PerfChartFilterHintProps {
    isVisible: boolean;
}

function PerfChartFilterHint({ isVisible }: PerfChartFilterHintProps) {
    if (!isVisible) {
        return null;
    }

    // TODO(#1737): Add a keyboard-operable path for chart-driven table filtering.
    // Current interaction is pointer-click only through plot handlers.

    return (
        <p
            className='perf-chart-hint'
            data-testid={TEST_IDS.PERF_CHART_TABLE_FILTER_HINT}
        >
            {PERF_CHART_TABLE_FILTER_HINT}
        </p>
    );
}

export default PerfChartFilterHint;
