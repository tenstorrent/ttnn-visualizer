// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { CSSProperties, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { Config, Layout, PlotData, Shape } from 'plotly.js';
import { useAtomValue } from 'jotai';
import { PlotConfiguration, PlotMarker, PlotMouseEventCustom } from '../../definitions/PlotConfigurations';
import { selectedAddressAtom, showHexAtom } from '../../store/app';
import { getDimmedColour, getLightlyDimmedColour } from '../../functions/colour';

export interface MemoryPlotRendererProps {
    chartDataList: Partial<PlotData>[][];
    isZoomedIn: boolean;
    memorySize: number;
    title?: string;
    onBufferClick?: (event: Readonly<PlotMouseEventCustom>) => void;
    plotZoomRange?: [start: number, end: number];
    className?: string;
    configuration: PlotConfiguration;
    style?: CSSProperties;
    markers?: PlotMarker[];
}

const MemoryPlotRenderer: React.FC<MemoryPlotRendererProps> = ({
    chartDataList,
    isZoomedIn,
    memorySize,
    className = '',
    title,
    onBufferClick,
    plotZoomRange,
    configuration,
    style,
    markers,
}) => {
    const showHex = useAtomValue(showHexAtom);
    const chartData = useMemo(() => chartDataList.flat(), [chartDataList]);

    const selectedAddress = useAtomValue(selectedAddressAtom);
    const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

    const [augmentedChart, setAugmentedChart] = useState<Partial<PlotData>[]>(structuredClone(chartData));

    const range = isZoomedIn ? plotZoomRange : [0, memorySize];
    // If we need more flexibility on the tickformat front, we can expand this to accept a prop instead of defaulting to the below
    const tickFormat = showHex ? { tickformat: 'x', tickprefix: '0x' } : { tickformat: ',.0r' };

    const markerLines: Partial<Shape>[] =
        markers?.map((marker: PlotMarker) => ({
            type: 'line',
            xref: 'x',
            yref: 'paper',
            x0: marker.address,
            x1: marker.address,
            y0: -0.1,
            y1: 1.1,
            line: {
                color: marker.color,
                width: 2,
                dash: 'solid',
            },

            label: {
                text: marker.label,
                textposition: 'bottom left',
                font: {
                    size: 8,
                    color: marker.color,
                },
            },
        })) || [];

    const layout: Partial<Layout> = {
        autosize: true,
        height: configuration.height,
        xaxis: {
            autorange: false,
            title: { text: configuration.title || '' },
            range,
            showgrid: true,
            fixedrange: true,
            zeroline: false,
            color: 'white',
            gridcolor: configuration.gridColour || '#999',
            side: configuration.xAxis?.side || 'bottom',
            ...tickFormat,
            tickmode: configuration.xAxis?.tickmode || 'auto',
            tick0: configuration.xAxis?.tick0,
            dtick: configuration.xAxis?.dtick,
            tickvals: configuration.xAxis?.tickvals,
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
        plot_bgcolor: configuration.bgColour || 'white',
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
            ...markerLines,
        ],
        showlegend: false,
        hovermode: 'closest',
    };

    const config: Partial<Config> = {
        displayModeBar: false,
        displaylogo: false,
        staticPlot: onBufferClick === undefined,
        responsive: true,
    };

    useMemo(() => {
        setAugmentedChart(
            // creating a deep clone of the chart data to avoid mutating the original data
            (JSON.parse(JSON.stringify(chartData)) as Partial<PlotData>[]).map((data, index) => {
                if (!data?.marker?.color || !data?.x || !chartData?.[index]?.marker) {
                    return data;
                }

                const originalColour = chartData[index].marker?.color as string;
                const lightlyDimmedColour = getLightlyDimmedColour(originalColour);
                const dimmedColour = getDimmedColour(originalColour);

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
            style={style}
        >
            {title ? <h3 className='plot-title'>{title}</h3> : null}

            <Plot
                className='memory-plot js-plotly-plot'
                data={augmentedChart}
                layout={layout}
                config={config}
                // @ts-expect-error PlotMouseEventCustom extends PlotMouseEvent and will be fine
                onClick={onBufferClick}
                onHover={(data) => setHoveredPoint(data.points[0].x as number)}
                onUnhover={() => setHoveredPoint(null)}
                useResizeHandler
                style={{ width: '100%', height: configuration.height }}
            />
        </div>
    );
};

export default MemoryPlotRenderer;
