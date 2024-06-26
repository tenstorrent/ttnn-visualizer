import React from 'react';
import Plot from 'react-plotly.js';
import { Layout, PlotData, PlotMouseEvent } from 'plotly.js';

export interface L1MemoryRendererProps {
    chartData: Partial<PlotData>[];
    isZoomedIn: boolean;
    memorySize: number;
    title: string;
    onBufferClick?: (event: PlotMouseEvent) => void;
    plotZoomRangeStart?: number;
    plotZoomRangeEnd?: number;
}

const L1MemoryRenderer: React.FC<L1MemoryRendererProps> = ({
    chartData,
    isZoomedIn,
    memorySize,
    title,
    onBufferClick,
    plotZoomRangeStart,
    plotZoomRangeEnd,
}) => {
    const layout: Partial<Layout> = {
        height: 80,
        xaxis: {
            autorange: false,
            title: 'L1 Address Space',
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
        margin: {
            l: 5,
            r: 5,
            b: 40,
            t: 5,
        },
        paper_bgcolor: '#33333d',
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
        hovermode: 'x',
    };

    const config = {
        displayModeBar: false,
        displaylogo: false,
    };

    return (
        <>
            <h3 className='plot-title'>{title}</h3>
            <Plot
                //
                className='l1-memory-plot'
                data={chartData}
                layout={layout}
                config={config}
                onClick={onBufferClick}
            />
        </>
    );
};

export default L1MemoryRenderer;
