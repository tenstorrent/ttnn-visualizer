// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { useState } from 'react';
import { Collapse } from '@blueprintjs/core';
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
            <MemoryLegendElement
                chunk={group[0]}
                memSize={memSize}
                selectedTensorAddress={selectedTensorAddress}
                operationDetails={operationDetails}
                onLegendClick={onLegendClick}
                isGroupHeader
                isOpen={isOpen}
                handleOpenToggle={setIsOpen}
            />

            <Collapse isOpen={isOpen}>
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
