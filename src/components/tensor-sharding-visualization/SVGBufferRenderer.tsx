// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import { BufferPage } from '../../model/APIData';
import { pageDataToChunkArray } from '../../functions/getChartData';

interface SVGBufferRendererProps {
    height: number;
    data: BufferPage[];
    memorySize: number;
    memoryStart: number;
}

const SVGBufferRenderer: React.FC<SVGBufferRendererProps> = ({
    height,
    data,
    memorySize,
    memoryStart,
}: SVGBufferRendererProps) => {
    const memoryRange = memorySize - memoryStart;
    const mergedRange = pageDataToChunkArray(data);

    return (
        <svg
            height={height}
            width='100%'
        >
            <g>
                {mergedRange.map((range) => {
                    const xPercent = ((range.address - memoryStart) / memoryRange) * 100;
                    const widthPercent = (range.size / memoryRange) * 100;

                    return (
                        <rect
                            key={range.address}
                            x={`${xPercent}%`}
                            y={0}
                            width={`${widthPercent}%`}
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
