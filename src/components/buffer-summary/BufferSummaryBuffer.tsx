import classNames from 'classnames';
import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import { useState } from 'react';
import { useAtom } from 'jotai';
import { Buffer } from '../../model/APIData';
import { formatSize, toHex } from '../../functions/math';
import { HistoricalTensor } from '../../model/Graph';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { selectedTensorAtom } from '../../store/app';

interface BufferSummaryBufferProps {
    buffer: Buffer;
    size: number;
    position: number;
    tensor?: HistoricalTensor;
}

function BufferSummaryBuffer({ buffer, size, position, tensor }: BufferSummaryBufferProps) {
    const [isHovered, setIsHovered] = useState<boolean>(false);

    const [selectedTensor, setSelectedTensor] = useAtom(selectedTensorAtom);

    const styleProps = {
        width: `${size}%`,
        left: `${position}%`,
        backgroundColor: tensor ? getTensorColor(tensor.id) : getBufferColor(buffer.address),
    };

    return (
        <div
            className={classNames({ 'is-selected': tensor?.id === selectedTensor }, 'buffer-data')}
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
                    {/* Need this element for the onMouseLeave and therefore it needs the class to take up the correct space */}
                    <button
                        type='button'
                        aria-label={`Select buffer ${buffer.address}`}
                        onMouseLeave={() => setIsHovered(false)}
                        className='hover-target'
                        onClick={() => setSelectedTensor(tensor?.id === selectedTensor ? null : tensor?.id)}
                    />
                </Tooltip>
            ) : null}
        </div>
    );
}

export default BufferSummaryBuffer;
