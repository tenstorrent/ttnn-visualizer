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
}

interface Buffer {
    address: number;
    buffer_type: BufferType;
    device_id: number;
    size: number;
}

const SCALE = 100;

function BufferSummaryRow({ buffers, operationId, memorySize }: BufferSummaryRowProps) {
    return (
        <div className='buffer-summary-row'>
            {buffers.map((buffer: Buffer) => {
                const size = (buffer.size / memorySize) * SCALE;
                const position = (buffer.address / memorySize) * SCALE;

                return (
                    <div
                        key={`${operationId}-${buffer.address}`}
                        className='buffer-data'
                        style={{
                            width: `${size}%`,
                            left: `${position}%`,
                            backgroundColor: getBufferColor(buffer.address),
                        }}
                        // Dev debug data
                        data-address={buffer.address}
                        data-size={buffer.size}
                    />
                );
            })}
        </div>
    );
}

export default BufferSummaryRow;
