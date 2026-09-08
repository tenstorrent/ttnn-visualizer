// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PlotMouseEvent } from 'plotly.js';

interface PlotClickDatum {
    customdata?: unknown;
}

function getOpCodeFromCustomData(customdata: unknown): string | null {
    if (typeof customdata === 'string' && customdata.length > 0) {
        return customdata;
    }

    // Histogram traces store [rawOpCode, totalCount, sampleOpsSummary].
    if (Array.isArray(customdata)) {
        const opCode = customdata[0];
        return typeof opCode === 'string' && opCode.length > 0 ? opCode : null;
    }

    return null;
}

export function getRawOpCodeFromPlotClick(event: Readonly<PlotMouseEvent>): string | null {
    const point = event.points[0] as PlotClickDatum | undefined;
    if (!point) {
        return null;
    }

    return getOpCodeFromCustomData(point.customdata);
}
