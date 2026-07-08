// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PlotMouseEvent } from 'plotly.js';

interface PlotClickDatum {
    customdata?: unknown;
    label?: unknown;
}

export function getRawOpCodeFromPlotClick(event: Readonly<PlotMouseEvent>): string | null {
    const point = event.points[0] as PlotClickDatum | undefined;
    if (!point) {
        return null;
    }

    const raw = point.customdata ?? point.label;
    const opCode = Array.isArray(raw) ? raw[0] : raw;

    return typeof opCode === 'string' && opCode.length > 0 ? opCode : null;
}
