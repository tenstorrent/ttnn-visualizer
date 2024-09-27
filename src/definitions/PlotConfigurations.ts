import { PlotData, PlotDatum, PlotMouseEvent } from 'plotly.js';
import { HistoricalTensor } from '../model/Graph';

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
    title: 'L1 Address Space',
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
        tensor: HistoricalTensor | null;
    };
}

export interface PlotDataOverrides {
    color?: string;
    hovertemplate?: string;
    colorVariance?: number;
}
