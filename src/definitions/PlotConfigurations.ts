// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Annotations, Config, Layout, PlotData, PlotDatum, PlotMouseEvent } from 'plotly.js';
import { cssVar } from '../functions/colour';
import { Tensor } from '../model/APIData';

export const L1RenderConfiguration: PlotConfiguration = {
    height: 110,
    margin: {
        l: 5,
        r: 5,
        b: 40,
        t: 25,
    },
    title: 'L1 Address Space',
};

export const L1SmallRenderConfiguration: PlotConfiguration = {
    height: 90,
    margin: {
        l: 5,
        r: 5,
        b: 40,
        t: 25,
    },
    title: 'L1 Address Space',
};

export const L1RenderZoomoutConfiguration: PlotConfiguration = {
    height: 80,
    margin: {
        l: 5,
        r: 5,
        b: 40,
        t: 25,
    },
};

export const DRAMRenderConfiguration: PlotConfiguration = {
    height: 90,
    margin: {
        l: 5,
        r: 5,
        b: 30,
        t: 25,
    },
    title: 'DRAM Address Space',
};

export const CBRenderConfiguration: PlotConfiguration = {
    height: 80,
    margin: {
        l: 5,
        r: 5,
        b: 30,
        t: 25,
    },
    title: '',
};

// this is needed to render tooltips with tensor information, 80 is too small
export const BufferRenderConfiguration: PlotConfiguration = {
    height: 82,
    margin: {
        l: 5,
        r: 5,
        b: 30,
        t: 25,
    },
    title: '',
};

export const MAX_LEGEND_LENGTH = 20;

export const BufferSummaryAxisConfiguration: PlotConfiguration = {
    height: 615,
    margin: {
        l: 0,
        r: 0,
        b: 0,
        t: 15,
    },
    xAxis: {
        side: 'top',
    },
    gridColour: '#343434', // $tt-background
    bgColour: '#fff',
} as PlotConfiguration;

export interface AxisConfig {
    title?: {
        text?: string;
        /** Gap between the axis and its title — widen it to clear anything drawn in between. */
        standoff?: number;
    };
    showticklabels?: boolean;
    side?: 'top' | 'bottom';
    tickmode?: 'array' | 'auto' | 'linear';
    tick0?: number;
    dtick?: number;
    tickvals?: number[];
    range?: [number, number];
    tickformat?: string;
    hoverformat?: string;
}

export interface PlotConfiguration {
    height?: number;
    margin?: {
        l: number;
        r: number;
        b: number;
        t: number;
    };
    showLegend?: boolean;
    title?: string;
    gridColour?: string;
    bgColour?: string;
    xAxis?: AxisConfig;
    yAxis?: AxisConfig;
    yAxis2?: AxisConfig;
    barMode?: 'stack' | 'group';
    annotations?: Partial<Annotations>[];
}

export const CONDENSED_PLOT_CHUNK_COLOR = '#9c9e9f';

export interface PlotMouseEventCustom extends PlotMouseEvent {
    points: PlotDatumCustom[];
}

export interface PlotMarker {
    color: string;
    address: number;
    label?: string;
}

export interface PlotDatumCustom extends PlotDatum {
    data: PlotDataCustom;
}

export interface PlotDataCustom extends PlotData {
    memoryData: {
        address: number;
        size: number;
        tensor: Tensor | null;
        colorVariance?: number;
    };
}

export interface PlotDataOverrides {
    color?: string;
    hovertemplate?: string;
    colorVariance?: number;
    /** Render trace as a tinted-fill bordered overlay for aliased CBs. #1652 */
    outline?: boolean;
}

export const PerfChartConfig: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

/** Plotly/d3 tick format: integer with thousands separators (e.g. 1,000,000). */
export const NS_AXIS_TICK_FORMAT = ',d';
export const NS_AXIS_HOVER_FORMAT = ',.2r';

export const getNsAxisConfig = (titleText: string, overrides?: Partial<AxisConfig>): AxisConfig => ({
    title: { text: titleText },
    tickformat: NS_AXIS_TICK_FORMAT,
    hoverformat: NS_AXIS_HOVER_FORMAT,
    ...overrides,
});

/** Integer ticks without thousands separators — intentional for core counts (unlike ns `,d`). */
export const CORE_COUNT_AXIS_TICK_FORMAT = 'd';

export const getCoreCountAxisConfig = (maxCores: number, overrides?: Partial<AxisConfig>): AxisConfig => ({
    title: { text: 'Core Count' },
    tickformat: CORE_COUNT_AXIS_TICK_FORMAT,
    hoverformat: NS_AXIS_HOVER_FORMAT,
    range: [0, maxCores],
    ...overrides,
});

/** Shared left-pad margin for dual-series operation-index charts. */
export const PERF_CHART_WIDE_LEFT_MARGIN = {
    l: 100,
    r: 0,
    b: 50,
    t: 0,
};

export const PERF_CHART_TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** Y axis title gap, wide enough to clear the tick labels. */
const PERF_CHART_Y_AXIS_TITLE_STANDOFF = 20;

export interface PerfChartChrome {
    line: string;
    text: string;
    /** Page surface behind the charts — in-plot controls label themselves in it when their fill inverts. */
    surface: string;
}

/**
 * Read on use rather than captured at import: these resolve against the stylesheet, which
 * is not guaranteed to have applied when this module first evaluates. In-plot controls must
 * match the axes they sit against, so both come from here.
 */
export const getPerfChartChrome = (): PerfChartChrome => ({
    line: cssVar('--perf-chart-line'),
    text: cssVar('--perf-chart-text'),
    surface: cssVar('--perf-chart-surface'),
});

export const getPerfChartLayout = (): Partial<Layout> => {
    const chrome = getPerfChartChrome();
    const axisChrome = {
        gridcolor: chrome.line,
        linecolor: chrome.line,
        color: chrome.text,
        fixedrange: true,
        zeroline: false,
    };

    return {
        autosize: true,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        showlegend: false,
        margin: {
            l: 50,
            r: 0,
            b: 50,
            t: 0,
        },
        xaxis: {
            ...axisChrome,
            title: {
                font: {
                    color: chrome.text,
                },
            },
        },
        yaxis: {
            ...axisChrome,
            title: {
                standoff: PERF_CHART_Y_AXIS_TITLE_STANDOFF,
                font: {
                    color: chrome.text,
                },
            },
            automargin: true,
        },
        yaxis2: {
            ...axisChrome,
            title: {
                standoff: PERF_CHART_Y_AXIS_TITLE_STANDOFF,
                font: {
                    color: chrome.text,
                },
            },
            overlaying: 'y',
            side: 'right',
            automargin: true,
        },
    };
};

/** Shared shell for non-Cartesian charts (pie) routed through PerfChart. */
export const PerfPieChartLayout: Partial<Layout> = {
    autosize: true,
    paper_bgcolor: 'transparent',
    margin: {
        l: 50,
        r: 50,
        b: 50,
        t: 50,
    },
    showlegend: false,
};

export const L1_SMALL_MARKER_COLOR: string = '#FF0000';
export const L1_START_MARKER_COLOR: string = '#8EF32F';

export const getDeviceUtilizationAxisConfig = (maxValue: number): AxisConfig => ({
    title: { text: 'Utilization (%)' },
    tickformat: '.0%',
    hoverformat: '.2%',
    range: [0, Math.max(1.1, maxValue * 1.1)], // Using 1.1 because otherwise the top end tick label can get cut off
});
