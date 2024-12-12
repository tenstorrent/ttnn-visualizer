// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import 'styles/components/BufferSummaryRow.scss';
import { HistoricalTensor } from '../../model/Graph';
import BufferSummaryBuffer from './BufferSummaryBuffer';
import { Buffer } from '../../model/APIData';

interface BufferSummaryRowProps {
    buffers: Buffer[];
    operationId: number;
    memoryStart: number;
    memoryEnd: number;
    memoryPadding: number;
    tensorList: Map<number, HistoricalTensor>;
}

const SCALE = 100;

function BufferSummaryRow({
    buffers,
    operationId,
    memoryStart,
    memoryEnd,
    memoryPadding,
    tensorList,
}: BufferSummaryRowProps) {
    const computedMemorySize = memoryEnd - memoryStart;
    const computedPadding = (memoryPadding / computedMemorySize) * SCALE;

    return (
        <div
            className='buffer-summary-row'
            style={{
                margin: memoryStart > 0 ? `0 ${computedPadding}%` : '0',
            }}
        >
            {buffers.map((buffer: Buffer, index: number) => {
                const size = (buffer.size / computedMemorySize) * SCALE;
                const position = ((buffer.address - memoryStart) / computedMemorySize) * SCALE;
                const tensor = tensorList.get(buffer.address);

                return (
                    <BufferSummaryBuffer
                        key={`${operationId}-${buffer.address}-${index}`}
                        buffer={buffer}
                        size={size}
                        position={position}
                        tensor={tensor}
                    />
                );
            })}
        </div>
    );
}

export default BufferSummaryRow;
