import { ForwardRefRenderFunction } from 'react';
import tinycolor from 'tinycolor2';
import Plot from 'react-plotly.js';
import { Config, Layout, PlotData, PlotMouseEvent } from 'plotly.js';
import { useAtomValue } from 'jotai';
import { PlotConfiguration } from '../../definitions/PlotConfigurations';
import { selectedTensorAddressAtom } from '../../store/app';

export interface MemoryPlotRendererProps {
    chartData: Partial<PlotData>[];
    isZoomedIn: boolean;
    memorySize: number;
    title: string;
    onBufferClick?: (event: PlotMouseEvent) => void;
    plotZoomRangeStart?: number;
    plotZoomRangeEnd?: number;
    className?: string;
    configuration: PlotConfiguration;
}

const MemoryPlotRenderer: ForwardRefRenderFunction<HTMLDivElement, MemoryPlotRendererProps> = (
    {
        chartData,
        isZoomedIn,
        memorySize,
        className = '',
        title,
        onBufferClick,
        plotZoomRangeStart,
        plotZoomRangeEnd,
        configuration,
    },
    ref,
) => {
    const selectedAddress = useAtomValue(selectedTensorAddressAtom);

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

    return (
        <div
            className={className}
            ref={ref}
        >
            <h3 className='plot-title'>{title}</h3>

            <Plot
                className='memory-plot'
                data={chartData.map((data) => {
                    if (
                        selectedAddress &&
                        !data.hovertemplate?.includes(selectedAddress.toString()) &&
                        data.marker?.color
                    ) {
                        const colorString = data.marker.color as string;

                        data.marker.color = tinycolor(colorString).desaturate(40).toString();
                    }

                    return data;
                })}
                layout={layout}
                config={config}
                onClick={onBufferClick}
            />
        </div>
    );
};

export default MemoryPlotRenderer;
