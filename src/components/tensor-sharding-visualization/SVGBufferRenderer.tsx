import React from 'react';
import { BufferPage } from '../../model/APIData';

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
    const mergedRangeByAddress: Map<number, { start: number; end: number; color: string | undefined }> = new Map();

    data.forEach((page: BufferPage) => {
        const { address } = page;
        const defaultRange = { start: Infinity, end: 0, color: page.color };
        const currentRange = mergedRangeByAddress.get(address) || defaultRange;
        currentRange.start = Math.min(currentRange.start, page.page_address);
        currentRange.end = Math.max(currentRange.end, page.page_address + page.page_size);
        mergedRangeByAddress.set(address, currentRange);
    });

    return (
        <svg
            width={width}
            height={height}
        >
            <g>
                {Array.from(mergedRangeByAddress.entries()).map(([address, range]) => {
                    return (
                        <rect
                            key={address}
                            x={ratio * (range.start - memoryStart)}
                            y={0}
                            width={ratio * (range.end - range.start)}
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
