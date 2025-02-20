// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from 'react';
import classNames from 'classnames';
import { Icon, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { DeviceOperationLayoutTypes, DeviceOperationTypes, FragmentationEntry } from '../../model/APIData';
import { OperationDetails } from '../../model/OperationDetails';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { formatSize, prettyPrintAddress, toHex, toReadableShape, toReadableType } from '../../functions/math';
import 'styles/components/MemoryLegendElement.scss';

export const MemoryLegendElement: React.FC<{
    chunk: FragmentationEntry;
    memSize: number;
    selectedTensorAddress: number | null;
    operationDetails: OperationDetails;
    onLegendClick: (selectedTensorAddress: number, tensorId?: number | undefined) => void;
    colorVariance?: number | undefined; // color uniqueness for the CB color
    bufferType?: DeviceOperationTypes;
    layout?: DeviceOperationLayoutTypes;
    isMultiDeviceBuffer?: boolean;
    isGroupHeader?: boolean;
    className?: string;
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
    isGroupHeader = false,
    className,
}) => {
    const Component = chunk.empty ? 'div' : 'button';
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

    return (
        <Component
            key={chunk.address}
            className={classNames(
                'legend-item',
                {
                    button: !chunk.empty,
                    active: selectedTensorAddress === chunk.address,
                    dimmed: selectedTensorAddress !== null && selectedTensorAddress !== chunk.address,
                    'multi-device-buffer': isMultiDeviceBuffer,
                    'is-collapsible': !isMultiDeviceBuffer && isGroupHeader,
                },
                className,
            )}
            // eslint-disable-next-line react/jsx-props-no-spreading
            {...(!chunk.empty
                ? {
                      type: 'button',
                      onClick: () => onLegendClick(chunk.address, chunk.tensorId),
                  }
                : {})}
        >
            <div
                className={classNames('memory-color-block', {
                    empty: chunk.empty,
                })}
                style={{
                    ...(chunk.empty
                        ? {}
                        : {
                              backgroundColor:
                                  chunk.tensorId || derivedTensor
                                      ? getTensorColor(chunk.tensorId) || getTensorColor(derivedTensor?.id)
                                      : getBufferColor(chunk.address + (colorVariance || 0)),
                          }),
                }}
            />
            <div
                className={classNames('legend-details', {
                    'extra-info': bufferType || layout,
                    'shape-info': derivedTensor,
                    'multi-device-info': isMultiDeviceBuffer,
                    'is-group-header': !isMultiDeviceBuffer && isGroupHeader,
                })}
            >
                <div className='format-numbers monospace'>{prettyPrintAddress(chunk.address, memSize)}</div>
                <div className='format-numbers monospace keep-left'>({toHex(chunk.address)})</div>
                <div className='format-numbers monospace'>{formatSize(chunk.size)} </div>
                <div>
                    {!isMultiDeviceBuffer && !chunk.empty && derivedTensor && (
                        <>
                            {derivedTensor.operationIdentifier} : Tensor {derivedTensor.id}
                        </>
                    )}
                    {!isMultiDeviceBuffer && chunk.empty && emptyChunkLabel}
                </div>
                {(bufferType || layout) && (
                    <div className='extra-info-slot'>
                        {bufferType && <span className='monospace'>{DeviceOperationTypes[bufferType]} </span>}
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
            </div>
        </Component>
    );
};
