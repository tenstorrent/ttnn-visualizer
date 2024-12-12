// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Buffer } from '../../model/APIData';
import { formatSize, toHex } from '../../functions/math';
import { HistoricalTensor } from '../../model/Graph';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { renderMemoryLayoutAtom, selectedAddressAtom, selectedTensorAtom } from '../../store/app';
import { getDimmedColour } from '../../functions/colour';
import useBufferFocus from '../../hooks/useBufferFocus';
import { TensorMemoryLayout } from '../../functions/parseMemoryConfig';

interface BufferSummaryBufferProps {
    buffer: Buffer;
    size: number;
    position: number;
    tensor?: HistoricalTensor;
}

function BufferSummaryBuffer({ buffer, size, position, tensor }: BufferSummaryBufferProps) {
    const [isHovered, setIsHovered] = useState<boolean>(false);

    const [selectedTensor, setSelectedTensor] = useAtom(selectedTensorAtom);
    const [selectedAddress, setSelectedAddress] = useAtom(selectedAddressAtom);

    const showPattern = useAtomValue(renderMemoryLayoutAtom);

    const { createToast, resetToasts } = useBufferFocus();

    const tensorMemoryLayout = tensor?.memory_config?.memory_layout;
    const originalColour = tensor ? getTensorColor(tensor.id) : getBufferColor(buffer.address);
    const dimmedColour = originalColour ? getDimmedColour(originalColour) : '#000';
    const currentColour = (selectedTensor && selectedTensor !== tensor?.id ? dimmedColour : originalColour) ?? '#000';

    const styleProps = {
        width: `${size}%`,
        left: `${position}%`,
        ...(showPattern && tensorMemoryLayout
            ? getBackgroundPattern(tensorMemoryLayout, currentColour)
            : {
                  backgroundColor: currentColour,
              }),
    };

    const clearFocusedBuffer = () => {
        resetToasts();
    };

    const setFocusedBuffer = () => {
        setSelectedTensor(tensor?.id === selectedTensor ? null : tensor?.id ?? null);
        setSelectedAddress(tensor?.address === selectedTensor ? null : tensor?.address ?? buffer.address);
        createToast(tensor?.address ?? buffer.address, tensor?.id);
    };

    const handleFocusBuffer = (address: number) => {
        if (address === selectedAddress) {
            clearFocusedBuffer();
        } else {
            setFocusedBuffer();
        }
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
                            <strong>
                                <span style={{ fontSize: '20px', color: currentColour, marginRight: '2px' }}>
                                    &#9632;
                                </span>
                                {buffer.address} ({toHex(buffer.address)})<br />
                                Size: {formatSize(buffer.size)}
                                <br />
                                {tensor?.id ? `Tensor ${tensor.id}` : ''}
                                {tensor?.memory_config?.memory_layout ? (
                                    <>
                                        <br />
                                        {tensor?.memory_config?.memory_layout}
                                    </>
                                ) : null}
                            </strong>
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
                        onClick={() => handleFocusBuffer(buffer.address)}
                    />
                </Tooltip>
            ) : null}
        </div>
    );
}

const FG_COLOUR = 'rgba(0, 0, 0, 0.7)';

function getBackgroundPattern(
    layout: TensorMemoryLayout,
    colour: string,
): { backgroundImage?: string; backgroundSize?: string } {
    let pattern = {};

    if (layout === TensorMemoryLayout.INTERLEAVED) {
        pattern = {
            backgroundImage: `radial-gradient(${FG_COLOUR} 0.8px, ${colour} 0.8px)`,
            backgroundSize: '4px 4px',
        };
    }
    if (layout === TensorMemoryLayout.BLOCK_SHARDED) {
        pattern = {
            backgroundImage: `linear-gradient(${FG_COLOUR} 0.4px, transparent 0.4px), linear-gradient(to right, ${FG_COLOUR} 0.4px, ${colour} 0.4px)`,
            backgroundSize: '7px 7px',
        };
    }
    if (layout === TensorMemoryLayout.HEIGHT_SHARDED) {
        pattern = {
            backgroundSize: '6px',
            backgroundImage: `repeating-linear-gradient(to right, ${FG_COLOUR}, ${FG_COLOUR} 0.4px, ${colour} 0.4px, ${colour})`,
        };
    }

    return pattern;
}

export default BufferSummaryBuffer;
