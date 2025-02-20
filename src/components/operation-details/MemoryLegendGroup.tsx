// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { useState } from 'react';
import { Button, Collapse } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { FragmentationEntry } from '../../model/APIData';
import { OperationDetails } from '../../model/OperationDetails';
import { MemoryLegendElement } from './MemoryLegendElement';
import 'styles/components/MemoryLegendElement.scss';

export const MemoryLegendGroup: React.FC<{
    group: FragmentationEntry[];
    memSize: number;
    selectedTensorAddress: number | null;
    operationDetails: OperationDetails;
    onLegendClick: (selectedTensorAddress: number, tensorId?: number | undefined) => void;
}> = ({
    // no wrap eslint
    group,
    memSize,
    selectedTensorAddress,
    operationDetails,
    onLegendClick,
}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <div className='group-header'>
                <MemoryLegendElement
                    chunk={group[0]}
                    memSize={memSize}
                    selectedTensorAddress={selectedTensorAddress}
                    operationDetails={operationDetails}
                    onLegendClick={onLegendClick}
                    isGroupHeader
                    className='group-header-details'
                />

                <strong>x{group.length}</strong>

                <Button
                    className='group-collapse-toggle'
                    small
                    minimal
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(!isOpen);
                    }}
                    rightIcon={isOpen ? IconNames.CARET_UP : IconNames.CARET_DOWN}
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
                        />
                    ))}
                </div>
            </Collapse>
        </>
    );
};
