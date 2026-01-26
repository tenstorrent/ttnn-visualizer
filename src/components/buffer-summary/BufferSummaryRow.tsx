// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import 'styles/components/BufferSummaryRow.scss';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { useAtom } from 'jotai/index';
import classNames from 'classnames';
import { IconNames } from '@blueprintjs/icons';
import { Buffer, Tensor } from '../../model/APIData';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { formatMemorySize, toHex } from '../../functions/math';
import { toReadableLayout, toReadableShape, toReadableType } from '../../functions/formatting';
import { selectedAddressAtom, selectedTensorAtom } from '../../store/app';
import useBufferFocus from '../../hooks/useBufferFocus';
import { getDimmedColour } from '../../functions/colour';
import { TensorDeallocationReport } from '../../model/BufferSummary';
import getCanvasBackgroundPattern from '../../functions/getCanvasBackgroundPattern';

interface BufferSummaryRowProps {
    buffers: Buffer[];
    memoryStart: number;
    memoryEnd: number;
    memoryPadding: number;
    tensorList: Map<number, Tensor>;
    showMemoryLayout?: boolean;
    className?: string;
    tensorDeallocationReport?: TensorDeallocationReport[];
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
    tensorDeallocationReport = [],
    showMemoryLayout,
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
            let consumerOperationId = -1;
            let consumerName = '';
            const result = tensorDeallocationReport?.find((report) => report.address === buffer.address);
            if (result !== undefined) {
                notDeallocated = true;
                consumerOperationId = result.lastConsumerOperationId;
                consumerName = result.consumerName;
            }
            return {
                position,
                size,
                tensor,
                color,
                dimmedColor,
                buffer,
                notDeallocated,
                consumerOperationId,
                consumerName,
            };
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
                    const tensorMemoryLayout = tensor?.memory_config?.memory_layout;

                    if (selectedTensor && selectedTensor === tensor?.id) {
                        activeColor = color;
                    } else if (selectedAddress && selectedAddress !== buffer.address) {
                        activeColor = dimmedColor;
                    } else if (selectedAddress === buffer.address && selectedTensor && selectedTensor !== tensor?.id) {
                        activeColor = dimmedColor;
                    }

                    ctx.fillStyle = activeColor;
                    ctx.fillRect(position, 1, size, CANVAS_HEIGHT);

                    if (showMemoryLayout && tensorMemoryLayout && !notDeallocated) {
                        getCanvasBackgroundPattern(ctx, tensorMemoryLayout, position, size, CANVAS_HEIGHT);
                    }

                    if (notDeallocated) {
                        getWarningPattern(ctx, position, size);
                    }
                });
            }
        }
    }, [interactivityList, selectedAddress, selectedTensor, showMemoryLayout]);

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

            const missingDeallocationNotice = interactiveBuffer.notDeallocated ? (
                <>
                    <br />
                    Last consumer is{' '}
                    <u>
                        {interactiveBuffer.consumerOperationId} {interactiveBuffer.consumerName}
                    </u>
                    <br />
                    <Icon
                        intent={Intent.WARNING}
                        icon={IconNames.WARNING_SIGN}
                    />{' '}
                    Opportunity to deallocate earlier
                </>
            ) : null;

            setTooltip({
                x,
                y: 0,
                text: (
                    <div>
                        <strong>
                            <span style={{ fontSize: '20px', color, marginRight: '2px' }}>&#9632;</span>
                            {interactiveBuffer.buffer.address} ({toHex(interactiveBuffer.buffer.address)})<br />
                            {/* {showHex
                                ? toHex(interactiveBuffer.buffer.address)
                                : interactiveBuffer.buffer.address} -{' '} */}
                            {/* {showHex
                                ? toHex(interactiveBuffer.buffer.address + interactiveBuffer.buffer.size)
                                : interactiveBuffer.buffer.address + interactiveBuffer.buffer.size} */}
                            {formatMemorySize(interactiveBuffer.buffer.size, 2)}
                            <br />
                            {interactiveBuffer.tensor?.shape
                                ? toReadableShape(interactiveBuffer.tensor.shape)
                                : ''}{' '}
                            {interactiveBuffer.tensor?.dtype ? toReadableType(interactiveBuffer.tensor.dtype) : ''}{' '}
                            {interactiveBuffer.tensor?.id ? `Tensor ${interactiveBuffer.tensor.id}` : ''}
                            {interactiveBuffer.tensor?.memory_config?.memory_layout ? (
                                <>
                                    <br />
                                    {toReadableLayout(interactiveBuffer.tensor?.memory_config?.memory_layout)}
                                </>
                            ) : null}
                            {missingDeallocationNotice}
                        </strong>
                    </div>
                ),
            });
        } else {
            // eslint-disable-next-line no-unused-expressions, @typescript-eslint/no-unused-expressions
            canvasRef.current && (canvasRef.current.style.cursor = 'default');
            setTooltip(null);
        }
    };

    const handleMouseLeave = () => {
        setTooltip(null);
    };

    return (
        <div
            className={classNames('buffer-summary-row', className)}
            style={{
                padding: memoryStart > 0 ? `0 ${computedPadding}%` : '0',
            }}
        >
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
                        className='buffer-summary-tooltip-position'
                        style={{
                            left: `${tooltip.x}px`,
                        }}
                    />
                </Tooltip>
            )}

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
    );
};

function getWarningPattern(ctx: CanvasRenderingContext2D, position: number, size: number) {
    ctx.save();

    const warningStroke = 'rgba(0, 0, 0, 0.8)';

    // Draw diagonal lines
    ctx.beginPath();
    ctx.rect(position, 1, size, CANVAS_HEIGHT - 1);
    ctx.clip();
    ctx.strokeStyle = warningStroke;
    ctx.lineWidth = 1;
    const spacing = 8;

    for (let x = position - CANVAS_HEIGHT; x < position + size; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, CANVAS_HEIGHT);
        ctx.lineTo(x + CANVAS_HEIGHT, 1);
        ctx.stroke();
    }

    ctx.restore();

    // Add border stroke
    ctx.strokeStyle = warningStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(position, 1, size, CANVAS_HEIGHT - 2);
}

export default BufferSummaryRow;
