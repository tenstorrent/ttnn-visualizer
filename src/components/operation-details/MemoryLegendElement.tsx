// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import classNames from 'classnames';
import { Icon, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai';
import { ChunkBufferType, DeviceOperationLayoutTypes, FragmentationEntry, StringBufferType } from '../../model/APIData';
import { OperationDetails } from '../../model/OperationDetails';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { formatMemorySize, prettyPrintAddress } from '../../functions/math';
import { toReadableShape, toReadableType } from '../../functions/formatting';
import 'styles/components/MemoryLegendElement.scss';
import { L1_SMALL_MARKER_COLOR, L1_START_MARKER_COLOR } from '../../definitions/PlotConfigurations';
import { showHexAtom } from '../../store/app';
import useBufferFocus from '../../hooks/useBufferFocus';

export const MemoryLegendElement: React.FC<{
    chunk: FragmentationEntry;
    memSize: number;
    selectedTensorAddress: number | null;
    operationDetails: OperationDetails;
    onLegendClick: (selectedTensorAddress: number, tensorId?: number, colorVariance?: number) => void;
    colorVariance?: number | undefined; // color uniqueness for the CB color
    bufferType?: StringBufferType;
    layout?: DeviceOperationLayoutTypes;
    isMultiDeviceBuffer?: boolean;
    isGroupHeader?: boolean;
    className?: string;
    numCores?: number;
}> = ({
    // no wrap eslint
    chunk,
    memSize,
    selectedTensorAddress,
    operationDetails,
    onLegendClick,
    colorVariance,
    bufferType,
    layout,
    isMultiDeviceBuffer = false,
    className,
    numCores,
}) => {
    const showHex = useAtomValue(showHexAtom);
    const { selectedBufferColour } = useBufferFocus();
    const Component =
        chunk.empty || chunk.bufferType === ChunkBufferType.L1_SMALL || chunk.bufferType === ChunkBufferType.L1_START
            ? 'div'
            : 'button';
    const emptyChunkLabel = (
        <>
            <span>Empty space </span>
            {chunk.largestEmpty && (
                <Tooltip content='Largest empty memory space'>
                    <Icon
                        size={14}
                        icon={IconNames.SMALL_INFO_SIGN}
                    />
                </Tooltip>
            )}
        </>
    );

    const derivedTensor = operationDetails.getTensorForAddress(chunk.address);
    const numCoresLabel = numCores && numCores > 1 ? ` x ${numCores} cores` : '';

    const memorySquare = {
        ...(chunk.empty
            ? {}
            : {
                  backgroundColor:
                      chunk.tensorId || derivedTensor
                          ? getTensorColor(chunk.tensorId) || getTensorColor(derivedTensor?.id)
                          : getBufferColor(chunk.address + (colorVariance || 0)),
              }),
        ...(chunk.bufferType === ChunkBufferType.L1_SMALL && {
            backgroundColor: L1_SMALL_MARKER_COLOR,
        }),
        ...(chunk.bufferType === ChunkBufferType.L1_START && {
            backgroundColor: L1_START_MARKER_COLOR,
        }),
    };

    const isMatchingBufferColor = memorySquare.backgroundColor === selectedBufferColour;

    return (
        <Component
            key={chunk.address}
            className={classNames(
                'legend-item',
                {
                    button:
                        !chunk.empty &&
                        chunk.bufferType !== ChunkBufferType.L1_SMALL &&
                        chunk.bufferType !== ChunkBufferType.L1_START,
                    active: selectedTensorAddress === chunk.address && isMatchingBufferColor,
                    dimmed:
                        selectedBufferColour !== undefined &&
                        selectedTensorAddress !== null &&
                        (selectedTensorAddress !== chunk.address || !isMatchingBufferColor),
                    'extra-info': bufferType || layout,
                },
                className,
            )}
            // eslint-disable-next-line react/jsx-props-no-spreading
            {...(!chunk.empty &&
            chunk.bufferType !== ChunkBufferType.L1_SMALL &&
            chunk.bufferType !== ChunkBufferType.L1_START
                ? {
                      type: 'button',
                      onClick: () => onLegendClick(chunk.address, chunk.tensorId, colorVariance),
                  }
                : {})}
        >
            <div
                className={classNames('memory-color-block', {
                    empty: chunk.empty,
                })}
                style={memorySquare}
            />
            <div className='format-numbers monospace'>{prettyPrintAddress(chunk.address, memSize, showHex)}</div>
            <div className='format-numbers monospace nowrap'>
                {/* eslint-disable-next-line no-nested-ternary */}
                {chunk.bufferType === ChunkBufferType.L1_SMALL ? (
                    'L1 SMALL region'
                ) : chunk.bufferType === ChunkBufferType.L1_START ? (
                    'L1 START'
                ) : (
                    <>
                        {formatMemorySize(chunk.size, 2)}
                        {numCoresLabel}
                    </>
                )}
            </div>
            <div>
                {!isMultiDeviceBuffer && !chunk.empty && derivedTensor && (
                    <>
                        {derivedTensor.operationIdentifier} {derivedTensor.operationIdentifier && ':'} Tensor{' '}
                        {derivedTensor.id}
                    </>
                )}
                {!isMultiDeviceBuffer && chunk.empty && emptyChunkLabel}
            </div>
            {(bufferType || layout) && (
                <div className='extra-info-slot'>
                    {bufferType && <span className='monospace'>{StringBufferType[bufferType]} </span>}
                    {layout && <span className='monospace'>{DeviceOperationLayoutTypes[layout]}</span>}
                </div>
            )}
            <div className='shape-info-slot'>
                {derivedTensor && (
                    <>
                        {toReadableShape(derivedTensor.shape)} &nbsp; {toReadableType(derivedTensor.dtype)} &nbsp;{' '}
                        {isMultiDeviceBuffer && `Device ${chunk?.device_id ?? derivedTensor.device_id}`}
                    </>
                )}
            </div>
        </Component>
    );
};
