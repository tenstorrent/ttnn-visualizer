// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PlotMouseEvent } from 'plotly.js';

interface PlotClickDatum {
    customdata?: unknown;
}

export function getRawOpCodeFromPlotClick(event: Readonly<PlotMouseEvent>): string | null {
    const point = event.points[0] as PlotClickDatum | undefined;
    if (!point) {
        return null;
    }

    const opCode = point.customdata;

    return typeof opCode === 'string' && opCode.length > 0 ? opCode : null;
}
