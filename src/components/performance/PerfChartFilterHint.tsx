// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { TEST_IDS } from '../../definitions/TestIds';
import 'styles/components/PerfChartFilterHint.scss';

interface PerfChartFilterHintProps {
    text: string;
}

function PerfChartFilterHint({ text }: PerfChartFilterHintProps) {
    // TODO(#1737): Add a keyboard-operable path for chart-driven table filtering.
    // Current interaction is pointer-click only through plot handlers.

    return (
        <p
            className='perf-chart-hint'
            data-testid={TEST_IDS.PERF_CHART_TABLE_FILTER_HINT}
        >
            {text}
        </p>
    );
}

export default PerfChartFilterHint;
