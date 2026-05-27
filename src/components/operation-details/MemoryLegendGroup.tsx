// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';
import { Button, ButtonVariant, Collapse, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { FragmentationEntry } from '../../model/APIData';
import { OperationDetails } from '../../model/OperationDetails';
import { MemoryLegendElement } from './MemoryLegendElement';
import 'styles/components/MemoryLegendElement.scss';

interface MemoryLegendGroupProps {
    group: FragmentationEntry[];
    memSize: number;
    selectedTensorAddress: number | null;
    operationDetails: OperationDetails;
    onLegendClick: (selectedTensorAddress: number, tensorId?: number, colorVariance?: number) => void;
    userL1ZoomRange?: [number, number];
}

export const MemoryLegendGroup = ({
    // no wrap eslint
    group,
    memSize,
    selectedTensorAddress,
    operationDetails,
    onLegendClick,
    userL1ZoomRange,
}: MemoryLegendGroupProps) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <div className='group-header'>
                <MemoryLegendElement
                    className='details'
                    chunk={group[0]}
                    memSize={memSize}
                    selectedTensorAddress={selectedTensorAddress}
                    operationDetails={operationDetails}
                    onLegendClick={onLegendClick}
                    isGroupHeader
                    userL1ZoomRange={userL1ZoomRange}
                />

                <strong>x{group.length}</strong>

                <Button
                    className='collapse-toggle'
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(!isOpen);
                    }}
                    endIcon={isOpen ? IconNames.CARET_UP : IconNames.CARET_DOWN}
                    size={Size.SMALL}
                    variant={ButtonVariant.MINIMAL}
                />
            </div>

            <Collapse
                isOpen={isOpen}
                keepChildrenMounted
            >
                <div className='grouped-legend-elements'>
                    {group.map((chunk: FragmentationEntry, index: number) => (
                        <MemoryLegendElement
                            chunk={chunk}
                            key={`${chunk.address}-${index}`}
                            memSize={memSize}
                            selectedTensorAddress={selectedTensorAddress}
                            operationDetails={operationDetails}
                            onLegendClick={onLegendClick}
                            isMultiDeviceBuffer
                            userL1ZoomRange={userL1ZoomRange}
                        />
                    ))}
                </div>
            </Collapse>
        </>
    );
};
