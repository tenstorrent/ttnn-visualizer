// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { BufferType } from '../model/BufferType';
import 'styles/components/BufferSummaryRow.scss';
import { getBufferColor } from '../functions/colorGenerator';

interface BufferSummaryRowProps {
    buffers: Buffer[];
    operationId: number;
    memorySize: number;
    memoryStart?: number;
    memoryPadding?: number;
}

interface Buffer {
    address: number;
    buffer_type: BufferType;
    device_id: number;
    size: number;
}

const SCALE = 100;

function BufferSummaryRow({
    buffers,
    operationId,
    memorySize,
    memoryStart = 0,
    memoryPadding = 0,
}: BufferSummaryRowProps) {
    const computedMemorySize = memorySize - memoryStart;
    const paddingOffset = (memoryPadding / 2 / computedMemorySize) * SCALE;

    return (
        <div className='buffer-summary-row'>
            {buffers.map((buffer: Buffer) => {
                const size = (buffer.size / computedMemorySize) * SCALE;
                const position = ((buffer.address - memoryStart) / computedMemorySize) * SCALE + paddingOffset;

                return (
                    <div
                        key={`${operationId}-${buffer.address}`}
                        className='buffer-data'
                        style={{
                            width: `${size}%`,
                            left: `${position + paddingOffset}%`,
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
