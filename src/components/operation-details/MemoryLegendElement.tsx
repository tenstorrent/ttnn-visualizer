// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import classNames from 'classnames';
import { Icon, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai';
import { DeviceOperationLayoutTypes, FragmentationEntry, MarkerType, MarkerTypeLabel } from '../../model/APIData';
import { OperationDetails } from '../../model/OperationDetails';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { formatMemorySize, prettyPrintAddress } from '../../functions/math';
import { toReadableShape, toReadableType } from '../../functions/formatting';
import 'styles/components/MemoryLegendElement.scss';
import { L1_SMALL_MARKER_COLOR, L1_START_MARKER_COLOR } from '../../definitions/PlotConfigurations';
import { selectedBufferColourAtom, showHexAtom } from '../../store/app';
import { StringBufferType, StringBufferTypeLabel } from '../../model/BufferType';
import { isAddressRangeOutOfL1Zoom } from '../../functions/isAddressRangeVisibleInL1Zoom';

const LEGEND_AXIS_MARKER_COLORS: Partial<Record<MarkerType, string>> = {
    [MarkerType.L1_SMALL]: L1_SMALL_MARKER_COLOR,
    [MarkerType.L1_START]: L1_START_MARKER_COLOR,
};

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
    userL1ZoomRange?: [number, number];
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
    userL1ZoomRange,
}) => {
    const showHex = useAtomValue(showHexAtom);
    const selectedBufferColour = useAtomValue(selectedBufferColourAtom);
    const legendMarkerColor =
        chunk.markerType !== undefined ? (LEGEND_AXIS_MARKER_COLORS[chunk.markerType] ?? null) : null;
    const isLegendMarker = legendMarkerColor !== null;

    const Component = chunk.empty || isLegendMarker ? 'div' : 'button';
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
        ...(!chunk.empty &&
            !isLegendMarker && {
                backgroundColor:
                    chunk.tensorId || derivedTensor
                        ? getTensorColor(chunk.tensorId) || getTensorColor(derivedTensor?.id)
                        : getBufferColor(chunk.address + (colorVariance || 0)),
            }),
        ...(Number.isNaN(chunk.address) && { backgroundColor: 'white' }),
    };

    const isMatchingBufferColour = memorySquare.backgroundColor === selectedBufferColour;
    const chunkSize = chunk.size ?? 0;
    const isOutOfL1ZoomRange =
        !isLegendMarker &&
        !Number.isNaN(chunk.address) &&
        chunkSize > 0 &&
        isAddressRangeOutOfL1Zoom(chunk.address, chunk.address + chunkSize, userL1ZoomRange);

    let legendSwatch: React.ReactNode;
    if (isLegendMarker) {
        legendSwatch = (
            <div
                className='legend-marker-swatch'
                style={{ '--legend-marker-color': legendMarkerColor } as React.CSSProperties}
            />
        );
    } else if (chunk.empty) {
        legendSwatch = <div className='legend-empty-swatch' />;
    } else {
        legendSwatch = (
            <div
                className='memory-color-block'
                style={memorySquare}
            />
        );
    }

    return (
        <Component
            key={chunk.address}
            className={classNames(
                'legend-item',
                {
                    button: !chunk.empty && !isLegendMarker,
                    active: selectedTensorAddress === chunk.address && isMatchingBufferColour,
                    dimmed:
                        isOutOfL1ZoomRange ||
                        (selectedBufferColour !== null &&
                            selectedTensorAddress !== null &&
                            (selectedTensorAddress !== chunk.address || !isMatchingBufferColour)),
                    'extra-info': bufferType || layout,
                },
                className,
            )}
            {...(!chunk.empty && !isLegendMarker
                ? {
                      type: 'button',
                      onClick: () => onLegendClick(chunk.address, chunk.tensorId, colorVariance),
                  }
                : {})}
        >
            {legendSwatch}
            <div className='format-numbers monospace'>
                {!Number.isNaN(chunk.address) ? prettyPrintAddress(chunk.address, memSize, showHex) : 'N/A'}
            </div>
            <div className='format-numbers monospace nowrap'>
                {isLegendMarker && chunk.markerType ? (
                    MarkerTypeLabel[chunk.markerType]
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
                    {bufferType && <span className='monospace'>{StringBufferTypeLabel[bufferType]} </span>}
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
