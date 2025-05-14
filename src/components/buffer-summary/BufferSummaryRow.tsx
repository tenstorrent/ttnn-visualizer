// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import 'styles/components/BufferSummaryRow.scss';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import { useAtom } from 'jotai/index';
import classNames from 'classnames';
import { Buffer, Tensor } from '../../model/APIData';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { formatSize, toHex, toReadableShape, toReadableType } from '../../functions/math';
import { selectedAddressAtom, selectedTensorAtom } from '../../store/app';
import useBufferFocus from '../../hooks/useBufferFocus';
import { getDimmedColour } from '../../functions/colour';
import { TensorDeallocationReport } from '../../model/BufferSummary';

interface BufferSummaryRowProps {
    buffers: Buffer[];
    memoryStart: number;
    memoryEnd: number;
    memoryPadding: number;
    tensorList: Map<number, Tensor>;
    className?: string;
    tensorDeallocationReport: TensorDeallocationReport[];
}

const SCALE = 100;
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 20;
const TARGET_SCALE = (CANVAS_WIDTH / SCALE) * 100;

const BufferSummaryRow = ({
    buffers,
    memoryStart,
    memoryEnd,
    memoryPadding,
    tensorList,
    className = '',
    tensorDeallocationReport,
}: BufferSummaryRowProps) => {
    const computedMemorySize = memoryEnd - memoryStart;
    const computedPadding = (memoryPadding / computedMemorySize) * SCALE;

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; text: React.JSX.Element } | null>(null);
    const [selectedTensor, setSelectedTensor] = useAtom(selectedTensorAtom);
    const [selectedAddress, setSelectedAddress] = useAtom(selectedAddressAtom);
    const { createToast, resetToasts } = useBufferFocus();

    const interactivityList = useMemo(() => {
        return buffers.map((buffer) => {
            const size = (buffer.size / computedMemorySize) * TARGET_SCALE;
            const position = ((buffer.address - memoryStart) / computedMemorySize) * TARGET_SCALE;
            const tensor = tensorList.get(buffer.address);
            const color = (tensor ? getTensorColor(tensor.id) : getBufferColor(buffer.address)) || 'black';
            const dimmedColor = getDimmedColour(color);
            let notDeallocated = false;
            if (tensorDeallocationReport.some((el) => el.address === buffer.address)) {
                notDeallocated = true;
            }
            return { position, size, tensor, color, dimmedColor, buffer, notDeallocated };
        });
    }, [buffers, computedMemorySize, memoryStart, tensorList, tensorDeallocationReport]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

                interactivityList.forEach(({ color, position, size, buffer, dimmedColor, tensor, notDeallocated }) => {
                    let activeColor = color;

                    if (selectedTensor && selectedTensor === tensor?.id) {
                        activeColor = color;
                    } else if (selectedAddress && selectedAddress !== buffer.address) {
                        activeColor = dimmedColor;
                    } else if (selectedAddress === buffer.address && selectedTensor && selectedTensor !== tensor?.id) {
                        activeColor = dimmedColor;
                    }

                    ctx.fillStyle = activeColor;
                    ctx.fillRect(position, 1, size, CANVAS_HEIGHT);

                    if (notDeallocated) {
                        ctx.strokeStyle = '#000000';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(position, 1, size, CANVAS_HEIGHT - 2);

                        ctx.save();

                        ctx.beginPath();
                        ctx.rect(position, 1, size, CANVAS_HEIGHT - 1);
                        ctx.clip();

                        const spacing = 10;

                        for (let x = position - CANVAS_HEIGHT; x < position + size; x += spacing) {
                            ctx.beginPath();
                            ctx.moveTo(x, 1);
                            ctx.lineTo(x + CANVAS_HEIGHT, CANVAS_HEIGHT);
                            ctx.stroke();
                        }

                        ctx.restore();
                    }
                });
            }
        }
    }, [interactivityList, selectedAddress, selectedTensor]);

    const findBufferForInteraction = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = CANVAS_WIDTH / rect.width;
            const mouseX = (event.clientX - rect.left) * scaleX;
            return {
                interactiveBuffer: interactivityList.find((b) => mouseX >= b.position && mouseX <= b.position + b.size),
                scaleX,
                canvas,
            };
        }
        return {};
    };

    const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const { interactiveBuffer } = findBufferForInteraction(event);
        if (interactiveBuffer) {
            setFocusedBuffer(interactiveBuffer.buffer, interactiveBuffer.tensor);
        } else {
            clearFocusedBuffer();
        }
    };
    const clearFocusedBuffer = () => {
        resetToasts();
    };

    const setFocusedBuffer = (buffer: Buffer, tensor?: Tensor) => {
        if (!buffer) {
            clearFocusedBuffer();
            return;
        }
        setSelectedTensor(tensor?.id === selectedTensor ? null : (tensor?.id ?? null));
        setSelectedAddress(tensor?.address === selectedTensor ? null : (tensor?.address ?? buffer.address));
        createToast(tensor?.address ?? buffer.address, tensor?.id);
    };

    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const { interactiveBuffer, scaleX, canvas } = findBufferForInteraction(event);
        if (interactiveBuffer) {
            canvas.style.cursor = 'pointer';
            const x = interactiveBuffer.position / scaleX;
            const { color } = interactiveBuffer;

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
            // eslint-disable-next-line no-unused-expressions
            canvasRef.current && (canvasRef.current.style.cursor = 'default');
            setTooltip(null);
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
                    modifiers={{
                        offset: {
                            enabled: true,
                            options: {
                                offset: [tooltip.x, CANVAS_HEIGHT],
                            },
                        },
                    }}
                    minimal
                >
                    <div
                        className='buffer-summary-row-tooltip'
                        style={{
                            left: `${tooltip.x}px`,
                        }}
                    />
                </Tooltip>
            )}
            <div
                className={classNames('buffer-summary-row', className)}
                style={{
                    padding: memoryStart > 0 ? `0 ${computedPadding}%` : '0',
                }}
            >
                <canvas
                    className='canvas'
                    ref={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    onClick={handleClick}
                />
            </div>
        </>
    );
};

export default BufferSummaryRow;
