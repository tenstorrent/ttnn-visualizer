import React, { useRef } from 'react';
import Plot from 'react-plotly.js';
import { Config, Layout, PlotData, PlotMouseEvent } from 'plotly.js';
import useOutsideClick from '../../hooks/useOutsideClick';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';

export interface L1MemoryRendererProps {
    chartData: Partial<PlotData>[];
    isZoomedIn: boolean;
    memorySize: number;
    title: string;
    onBufferClick?: (event: PlotMouseEvent) => void;
    onClickOutside?: (event: MouseEvent) => void;
    plotZoomRangeStart?: number;
    plotZoomRangeEnd?: number;
    className?: string;
    additionalReferences?: React.RefObject<HTMLDivElement>[];
    configuration: PlotConfiguration;
}

const MemoryPlotRenderer: React.FC<L1MemoryRendererProps> = ({
    chartData,
    isZoomedIn,
    memorySize,
    className = '',
    title,
    onBufferClick,
    onClickOutside,
    plotZoomRangeStart,
    plotZoomRangeEnd,
    additionalReferences = [],
    configuration,
}) => {
    const layout: Partial<Layout> = {
        height: configuration.height,
        xaxis: {
            autorange: false,
            title: configuration.title || '',
            range: [isZoomedIn ? plotZoomRangeStart : 0, isZoomedIn ? plotZoomRangeEnd : memorySize],
            showgrid: true,
            fixedrange: true,
            zeroline: false,
            tickformat: 'd',
            color: 'white',
            gridcolor: '#999',
        },
        yaxis: {
            range: [0, 1],
            fixedrange: true,
            showgrid: false,
            zeroline: false,
            showticklabels: false,
        },
        margin: configuration.margin,

        paper_bgcolor: 'transparent',
        plot_bgcolor: 'white',
        shapes: [
            {
                type: 'rect',
                xref: 'paper',
                yref: 'paper',
                x0: 0,
                y0: 0,
                x1: 1,
                y1: 1,
                line: {
                    color: 'black',
                    width: 0.5,
                },
            },
        ],
        showlegend: false,
        hovermode: 'closest',
    };

    const config: Partial<Config> = {
        displayModeBar: false,
        displaylogo: false,
        staticPlot: onBufferClick === undefined,
    };

    const plotRef = useRef<HTMLDivElement>(null);

    useOutsideClick([plotRef, ...additionalReferences], onClickOutside);

    return (
        <div
            className={className}
            ref={plotRef}
        >
            <h3 className='plot-title'>{title}</h3>
            <Plot
                className='memory-plot'
                data={chartData}
                layout={layout}
                config={config}
                onClick={onBufferClick}
            />
        </div>
    );
};

export default MemoryPlotRenderer;
