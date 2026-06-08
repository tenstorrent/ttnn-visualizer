// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { BufferChunk } from '../../model/APIData';

interface SVGBufferRendererProps {
    height: number;
    data: BufferChunk[];
    memoryStart: number;
    memoryEnd: number;
}

const SVGBufferRenderer = ({ height, data, memoryStart, memoryEnd }: SVGBufferRendererProps) => {
    const memoryRange = memoryEnd - memoryStart;

    return (
        <svg
            height={height}
            width='100%'
        >
            <g>
                {data.map((chunk) => {
                    const xPercent = ((chunk.address - memoryStart) / memoryRange) * 100;
                    const widthPercent = (chunk.chunk_size / memoryRange) * 100;

                    return (
                        <rect
                            key={chunk.address}
                            x={`${xPercent}%`}
                            y={0}
                            width={`${widthPercent}%`}
                            height={height}
                            fill={chunk.color || 'red'}
                        />
                    );
                })}
            </g>
        </svg>
    );
};

export default SVGBufferRenderer;
