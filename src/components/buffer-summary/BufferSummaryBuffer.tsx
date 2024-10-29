import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import { useState } from 'react';
import { useAtom } from 'jotai';
import { Buffer } from '../../model/APIData';
import { formatSize, toHex } from '../../functions/math';
import { HistoricalTensor } from '../../model/Graph';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { selectedTensorAtom } from '../../store/app';
import { getDimmedColour } from '../../functions/colour';

interface BufferSummaryBufferProps {
    buffer: Buffer;
    size: number;
    position: number;
    tensor?: HistoricalTensor;
}

function BufferSummaryBuffer({ buffer, size, position, tensor }: BufferSummaryBufferProps) {
    const [isHovered, setIsHovered] = useState<boolean>(false);

    const [selectedTensor, setSelectedTensor] = useAtom(selectedTensorAtom);

    const originalColour = tensor ? getTensorColor(tensor.id) : getBufferColor(buffer.address);
    const dimmedColour = originalColour ? getDimmedColour(originalColour) : '#000';

    const styleProps = {
        width: `${size}%`,
        left: `${position}%`,
        backgroundColor: selectedTensor && selectedTensor !== tensor?.id ? dimmedColour : originalColour,
    };

    return (
        <div
            className='buffer-data'
            style={styleProps}
            onMouseEnter={() => setIsHovered(true)}
        >
            {isHovered ? (
                <Tooltip
                    content={
                        <div>
                            {buffer.address} ({toHex(buffer.address)})<br />
                            Size: {formatSize(buffer.size)}
                            <br />
                            {tensor?.id ? `Tensor ${tensor.id}` : ''}
                        </div>
                    }
                    position={PopoverPosition.TOP}
                    // Need this class to override some Blueprint styling
                    className='hover-target'
                >
                    <button
                        type='button'
                        aria-label={`Select buffer ${buffer.address}`}
                        onMouseLeave={() => setIsHovered(false)}
                        className='buffer-button'
                        onClick={() => setSelectedTensor(tensor?.id === selectedTensor ? null : tensor?.id)}
                    />
                </Tooltip>
            ) : null}
        </div>
    );
}

export default BufferSummaryBuffer;
