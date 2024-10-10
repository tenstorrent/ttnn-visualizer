// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { BufferType } from '../model/BufferType';
import 'styles/components/BufferSummaryRow.scss';
import { getBufferColor } from '../functions/colorGenerator';

interface BufferSummaryRowProps {
    buffers: Buffer[];
    operationId: number;
    memoryStart: number;
    memoryEnd: number;
    memoryPadding: number;
}

interface Buffer {
    address: number;
    buffer_type: BufferType;
    device_id: number;
    size: number;
}

const SCALE = 100;

function BufferSummaryRow({ buffers, operationId, memoryStart, memoryEnd, memoryPadding }: BufferSummaryRowProps) {
    const computedMemorySize = memoryEnd - memoryStart;
    const computedPadding = (memoryPadding / computedMemorySize) * SCALE;

    return (
        <div
            className='buffer-summary-row'
            style={{
                margin: memoryStart > 0 ? `0 ${computedPadding}%` : '0',
            }}
        >
            {buffers.map((buffer: Buffer) => {
                const size = (buffer.size / computedMemorySize) * SCALE;
                const position = ((buffer.address - memoryStart) / computedMemorySize) * SCALE;

                return (
                    <div
                        key={`${operationId}-${buffer.address}`}
                        className='buffer-data'
                        style={{
                            width: `${size}%`,
                            left: `${position}%`,
                            backgroundColor: getBufferColor(buffer.address),
                        }}
                        data-address={buffer.address}
                        data-size={buffer.size}
                    />
                );
            })}
        </div>
    );
}

export default BufferSummaryRow;
