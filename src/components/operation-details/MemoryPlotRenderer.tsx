import React, { useMemo, useState } from 'react';
import tinycolor from 'tinycolor2';
import Plot from 'react-plotly.js';
import { Config, Layout, PlotData } from 'plotly.js';
import { useAtomValue } from 'jotai';
import { PlotConfiguration, PlotMouseEventCustom } from '../../definitions/PlotConfigurations';
import { selectedTensorAddressAtom } from '../../store/app';

export interface MemoryPlotRendererProps {
    chartDataList: Partial<PlotData>[][];
    isZoomedIn: boolean;
    memorySize: number;
    title: string;
    onBufferClick?: (event: Readonly<PlotMouseEventCustom>) => void;
    plotZoomRange?: [start: number, end: number];
    className?: string;
    configuration: PlotConfiguration;
}

const MemoryPlotRenderer: React.FC<MemoryPlotRendererProps> = ({
    //
    chartDataList,
    isZoomedIn,
    memorySize,
    className = '',
    title,
    onBufferClick,
    plotZoomRange,
    configuration,
}) => {
    const chartData = useMemo(() => chartDataList.flat(), [chartDataList]);

    const selectedAddress = useAtomValue(selectedTensorAddressAtom);
    const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

    const [augmentedChart, setAugmentedChart] = useState<Partial<PlotData>[]>(structuredClone(chartData));

    const range = isZoomedIn ? plotZoomRange : [0, memorySize];

    const layout: Partial<Layout> = {
        height: configuration.height,
        xaxis: {
            autorange: false,
            title: configuration.title || '',
            range,
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
        setAugmentedChart(
            (JSON.parse(JSON.stringify(chartData)) as Partial<PlotData>[]).map((data, index) => {
                if (!data?.marker?.color || !data?.x || !chartData?.[index]?.marker) {
                    return data;
                }

                const originalColour = chartData[index].marker?.color as string;
                const lightlyDimmedColour = tinycolor(originalColour).desaturate(15).darken(5).toString();
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
        <div className={className}>
            <h3 className='plot-title'>{title}</h3>
            <Plot
                className='memory-plot'
                data={augmentedChart}
                layout={layout}
                config={config}
                // @ts-expect-error PlotMouseEventCustom extends PlotMouseEvent and will be fine
                onClick={onBufferClick}
                onHover={(data) => setHoveredPoint(data.points[0].x as number)}
                onUnhover={() => setHoveredPoint(null)}
            />
        </div>
    );
};

export default MemoryPlotRenderer;
