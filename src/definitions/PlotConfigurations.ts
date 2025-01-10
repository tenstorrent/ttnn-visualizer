// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PlotData, PlotDatum, PlotMouseEvent } from 'plotly.js';
import { HistoricalTensor, TensorData } from '../model/APIData';

export const L1RenderConfiguration = {
    height: 110,
    margin: {
        l: 5,
        r: 5,
        b: 40,
        t: 25,
    },
    title: 'L1 Address Space',
} as PlotConfiguration;

export const L1SmallRenderConfiguration = {
    height: 90,
    margin: {
        l: 5,
        r: 5,
        b: 40,
        t: 25,
    },
    title: 'L1 Address Space',
};

export const DRAMRenderConfiguration = {
    height: 90,
    margin: {
        l: 5,
        r: 5,
        b: 30,
        t: 25,
    },
    title: 'DRAM Address Space',
} as PlotConfiguration;

export const CBRenderConfiguration = {
    height: 80,
    margin: {
        l: 5,
        r: 5,
        b: 30,
        t: 25,
    },
    title: '',
} as PlotConfiguration;

export const MAX_LEGEND_LENGTH = 20;

export const BufferSummaryAxisConfiguration = {
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
    height: number;
    margin: {
        l: number;
        r: number;
        b: number;
        t: number;
    };
    title?: string;
    gridColour?: string;
    bgColour?: string;
    xAxis?: {
        side?: 'top' | 'bottom';
        tickmode?: 'array' | 'auto' | 'linear';
        tick0?: number;
        dtick?: number;
        tickvals?: number[];
    };
}

export const CONDENSED_PLOT_CHUNK_COLOR = '#9c9e9f';

export interface PlotMouseEventCustom extends PlotMouseEvent {
    points: PlotDatumCustom[];
}

export interface PlotDatumCustom extends PlotDatum {
    data: PlotDataCustom;
}

export interface PlotDataCustom extends PlotData {
    memoryData: {
        address: number;
        size: number;
        tensor: HistoricalTensor | TensorData | null;
    };
}

export interface PlotDataOverrides {
    color?: string;
    hovertemplate?: string;
    colorVariance?: number;
}
