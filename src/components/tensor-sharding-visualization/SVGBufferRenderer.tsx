import React from 'react';
import { BufferPage } from '../../model/APIData';
import { pageDataToChunkArray } from '../../functions/getChartData';

interface SVGBufferRendererProps {
    width: number;
    height: number;
    data: BufferPage[];
    memorySize: number;
    memoryStart: number;
}

const SVGBufferRenderer: React.FC<SVGBufferRendererProps> = ({
    width,
    height,
    data,
    memorySize,
    memoryStart,
}: SVGBufferRendererProps) => {
    const ratio = width / (memorySize - memoryStart);
    const mergedRange = pageDataToChunkArray(data);

    return (
        <svg
            width={width}
            height={height}
        >
            <g>
                {mergedRange.map((range) => {
                    return (
                        <rect
                            key={range.address}
                            x={ratio * (range.address - memoryStart)}
                            y={0}
                            width={ratio * range.size}
                            height={height}
                            fill={range.color || 'red'}
                        />
                    );
                })}
            </g>
        </svg>
    );
};

export default SVGBufferRenderer;
