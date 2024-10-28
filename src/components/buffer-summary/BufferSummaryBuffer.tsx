import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import { useState } from 'react';
import { Buffer } from '../../model/APIData';
import { formatSize, toHex } from '../../functions/math';
import { HistoricalTensor } from '../../model/Graph';

interface BufferSummaryBufferProps {
    bufferData: Buffer;
    style: {
        width: string;
        left: string;
        backgroundColor?: string;
    };
    tensor?: HistoricalTensor;
}

function BufferSummaryBuffer({ bufferData, style, tensor }: BufferSummaryBufferProps) {
    const [isHovered, setIsHovered] = useState<boolean>(false);

    return (
        <div
            className='buffer-data'
            style={style}
            onMouseEnter={() => setIsHovered(true)}
        >
            {isHovered ? (
                <Tooltip
                    content={
                        <div>
                            {bufferData.address} ({toHex(bufferData.address)})<br />
                            Size: {formatSize(bufferData.size)}
                            <br />
                            {tensor?.id ? `Tensor ${tensor.id}` : ''}
                        </div>
                    }
                    position={PopoverPosition.TOP}
                    // Need this class to override some Blueprint styling
                    className='hover-target'
                >
                    {/* Need this element for the onMouseLeave and therefore it needs the class to take up the correct space */}
                    <div
                        onMouseLeave={() => setIsHovered(false)}
                        className='hover-target'
                    />
                </Tooltip>
            ) : null}
        </div>
    );
}

export default BufferSummaryBuffer;
