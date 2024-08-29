import { ForwardRefRenderFunction, useMemo, useState } from 'react';
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
    const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
    const [augmentedChart, setAugmentedChart] = useState<Partial<PlotData>[]>(structuredClone(chartData));

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

    useMemo(() => {
        setAugmentedChart((currentState) =>
            currentState.map((data, index) => {
                if (!data?.marker?.color || !data?.x || !chartData?.[index]?.marker) {
                    return data;
                }

                const originalColour = chartData[index].marker.color as string;
                const lightlyDimmedColour = tinycolor(originalColour).desaturate(20).darken(5).toString();
                const dimmedColour = tinycolor(originalColour).desaturate(40).darken(15).toString();

                if (selectedAddress) {
                    data.marker.color =
                        hoveredPoint === data.x[0] || data.hovertemplate?.includes(selectedAddress.toString())
                            ? originalColour
                            : dimmedColour;

                    return data;
                }

                // No selected address (but could be hovered)
                if (hoveredPoint) {
                    data.marker.color = hoveredPoint === data.x[0] ? originalColour : lightlyDimmedColour;

                    return data;
                }

                data.marker.color = lightlyDimmedColour;

                return data;
            }),
        );
    }, [hoveredPoint, chartData, selectedAddress]);

    return (
        <div
            className={className}
            ref={ref}
        >
            <h3 className='plot-title'>{title}</h3>

            <Plot
                className='memory-plot'
                data={augmentedChart}
                layout={layout}
                config={config}
                onClick={onBufferClick}
                onHover={(data) => setHoveredPoint(data.points[0].x as number)}
                onUnhover={() => setHoveredPoint(null)}
            />
        </div>
    );
};

export default MemoryPlotRenderer;
