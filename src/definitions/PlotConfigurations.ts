// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Config, Layout, PlotData, PlotDatum, PlotMouseEvent } from 'plotly.js';
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
    xAxis?: {
        title?: {
            text?: string;
        };
        side?: 'top' | 'bottom';
        tickmode?: 'array' | 'auto' | 'linear';
        tick0?: number;
        dtick?: number;
        tickvals?: number[];
        range?: [number, number];
        tickformat?: string;
        hoverformat?: string;
    };
    yAxis?: {
        title?: {
            text?: string;
        };
        range?: [number, number];
        tickformat?: string;
        hoverformat?: string;
    };
    yAxis2?: {
        title?: {
            text?: string;
        };
        range?: [number, number];
        tickformat?: string;
        hoverformat?: string;
    };
    barMode?: 'stack' | 'group';
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
    };
}

export interface PlotDataOverrides {
    color?: string;
    hovertemplate?: string;
    colorVariance?: number;
}

export const PerfChartConfig: Partial<Config> = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
};

const GRID_COLOUR = '#575757';
const LINE_COLOUR = '#575757';
const TITLE_COLOUR = '#FFF';

export const PerfChartLayout: Partial<Layout> = {
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
        gridcolor: GRID_COLOUR,
        linecolor: LINE_COLOUR,
        color: TITLE_COLOUR,
        title: {
            font: {
                color: TITLE_COLOUR,
            },
        },
        fixedrange: true,
        zeroline: false,
    },
    yaxis: {
        gridcolor: GRID_COLOUR,
        linecolor: LINE_COLOUR,
        color: TITLE_COLOUR,
        title: {
            standoff: 20,
            font: {
                color: TITLE_COLOUR,
            },
        },
        automargin: true,
        fixedrange: true,
        zeroline: false,
    },
    yaxis2: {
        gridcolor: GRID_COLOUR,
        linecolor: LINE_COLOUR,
        color: TITLE_COLOUR,
        title: {
            standoff: 20,
            font: {
                color: TITLE_COLOUR,
            },
        },
        overlaying: 'y',
        side: 'right',
        automargin: true,
        fixedrange: true,
        zeroline: false,
    },
};

export const L1_SMALL_MARKER_COLOR: string = '#FF0000';
export const L1_START_MARKER_COLOR: string = '#8EF32F';
