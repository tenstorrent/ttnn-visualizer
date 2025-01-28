// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import 'styles/components/BufferSummaryRow.scss';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import { Buffer, Tensor } from '../../model/APIData';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { formatSize, toHex, toReadableShape, toReadableType } from '../../functions/math';

interface BufferSummaryRowProps {
    buffers: Buffer[];
    memoryStart: number;
    memoryEnd: number;
    memoryPadding: number;
    tensorList: Map<number, Tensor>;
}

const SCALE = 100;

function BufferSummaryRow({ buffers, memoryStart, memoryEnd, memoryPadding, tensorList }: BufferSummaryRowProps) {
    const computedMemorySize = memoryEnd - memoryStart;
    const computedPadding = (memoryPadding / computedMemorySize) * SCALE;
    const CANVAS_WIDTH = 1200;
    const CANVAS_HEIGHT = 20;
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const targetScale = (CANVAS_WIDTH / SCALE) * 100;
    const [tooltip, setTooltip] = useState<{ x: number; y: number; text: React.JSX.Element } | null>(null);
    const interactivityList = useMemo(() => {
        return buffers.map((buffer) => {
            const size = (buffer.size / computedMemorySize) * targetScale;
            const position = ((buffer.address - memoryStart) / computedMemorySize) * targetScale;
            const tensor = tensorList.get(buffer.address);
            return { position, size, tensor, buffer };
        });
    }, [buffers, computedMemorySize, memoryStart, targetScale, tensorList]);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

                interactivityList.forEach(({ position, size, tensor, buffer }) => {
                    ctx.fillStyle = (tensor ? getTensorColor(tensor.id) : getBufferColor(buffer.address)) || 'black';
                    ctx.fillRect(position, 1, size, CANVAS_HEIGHT);
                });
            }
        }
    }, [interactivityList, CANVAS_HEIGHT, CANVAS_WIDTH]);
    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = CANVAS_WIDTH / rect.width;
            const mouseX = (event.clientX - rect.left) * scaleX;
            const interactiveBuffer = interactivityList.find(
                (b) => mouseX >= b.position && mouseX <= b.position + b.size,
            );

            if (interactiveBuffer) {
                const x = interactiveBuffer.position / scaleX;
                const color =
                    (interactiveBuffer.tensor
                        ? getTensorColor(interactiveBuffer.tensor.id)
                        : getBufferColor(interactiveBuffer.buffer.address)) || 'black';
                setTooltip({
                    x,
                    y: 0,
                    text: (
                        <div>
                            <strong>
                                <span style={{ fontSize: '20px', color, marginRight: '2px' }}>&#9632;</span>
                                {interactiveBuffer.buffer.address} ({toHex(interactiveBuffer.buffer.address)})<br />
                                Size: {formatSize(interactiveBuffer.buffer.size)}
                                <br />
                                {interactiveBuffer.tensor?.shape
                                    ? toReadableShape(interactiveBuffer.tensor.shape)
                                    : ''}{' '}
                                {interactiveBuffer.tensor?.dtype ? toReadableType(interactiveBuffer.tensor.dtype) : ''}{' '}
                                {interactiveBuffer.tensor?.id ? `Tensor ${interactiveBuffer.tensor.id}` : ''}
                                {interactiveBuffer.tensor?.memory_config?.memory_layout ? (
                                    <>
                                        <br />
                                        {interactiveBuffer.tensor?.memory_config?.memory_layout}
                                    </>
                                ) : null}
                            </strong>
                        </div>
                    ),
                });
            } else {
                setTooltip(null);
            }
        }
    };

    const handleMouseLeave = () => {
        setTooltip(null);
    };
    return (
        <>
            {tooltip && (
                <Tooltip
                    content={tooltip.text}
                    position={PopoverPosition.TOP}
                    hoverOpenDelay={0}
                    hoverCloseDelay={0}
                    isOpen
                    usePortal
                    minimal
                    modifiers={{
                        offset: {
                            enabled: true,
                            options: {
                                offset: [tooltip.x, CANVAS_HEIGHT],
                            },
                        },
                    }}
                >
                    <div
                        style={{
                            //
                            position: 'absolute',
                            top: 0,
                            left: `${tooltip.x}px`,
                            width: '0',
                            height: '0',
                            backgroundColor: 'red',
                            zIndex: 100,
                        }}
                    />
                </Tooltip>
            )}
            <div
                className='buffer-summary-row'
                style={{
                    margin: memoryStart > 0 ? `0 ${computedPadding}%` : '0',
                }}
            >
                <canvas
                    className='canvas'
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                />
            </div>
        </>
    );
}

export default BufferSummaryRow;
