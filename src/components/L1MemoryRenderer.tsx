import React from 'react';
import Plot from 'react-plotly.js';
import { Layout, PlotData, PlotMouseEvent } from 'plotly.js';

export interface L1MemoryRendererProps {
    chartData: Partial<PlotData>[];
    zoomedinView: boolean;
    memorySize: number;
    onBufferClick?: (event: PlotMouseEvent) => void;
    minRangeStart?: number;
}

const L1MemoryRenderer: React.FC<L1MemoryRendererProps> = ({
    chartData,
    zoomedinView,
    memorySize,
    onBufferClick,
    minRangeStart,
}) => {
    const layout: Partial<Layout> = {
        height: 60,
        xaxis: {
            autorange: false,
            title: '',
            range: [zoomedinView ? minRangeStart : 0, memorySize],
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
            b: 20,
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
        <Plot
            data={chartData}
            layout={layout}
            style={{ width: '100%', height: '110px' }}
            config={config}
            onClick={onBufferClick}
        />
    );
};

export default L1MemoryRenderer;
