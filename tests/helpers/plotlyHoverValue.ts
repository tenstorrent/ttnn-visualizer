// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { format } from 'd3-format';

interface HoverAxisFormats {
    hoverformat?: string;
    tickformat?: string;
}

// The text Plotly puts in a hovertemplate's `%{y}`, for specs where the Plot component is mocked:
// d3-format with the trace's `yhoverformat`, else the axis `hoverformat`, else the axis `tickformat`.
export const formatPlotlyHoverY = (
    value: number,
    trace: { yhoverformat?: string },
    axis: HoverAxisFormats | undefined,
): string => {
    const specifier = trace.yhoverformat || axis?.hoverformat || axis?.tickformat;

    if (!specifier) {
        throw new Error('No hover or tick format is set, and Plotly’s automatic number format isn’t modelled here');
    }

    return format(specifier)(value);
};
