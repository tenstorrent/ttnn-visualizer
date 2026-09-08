// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { TEST_IDS } from '../../definitions/TestIds';
import 'styles/components/PerfChartHint.scss';

interface PerfChartHintProps {
    text: string;
}

function PerfChartHint({ text }: PerfChartHintProps) {
    // TODO(#1737): Add a keyboard-operable path for chart-driven table filtering. Current
    // interaction is pointer-click only through plot handlers, and the histogram's bucket
    // controls are Plotly annotations with no role or accessible name — they also carry the
    // only range labelling in that chart, since it draws them in place of the x tick labels.

    return (
        <p
            className='perf-chart-hint'
            data-testid={TEST_IDS.PERF_CHART_HINT}
        >
            {text}
        </p>
    );
}

export default PerfChartHint;
