// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from 'react';
import { FragmentationEntry } from '../../model/APIData';
import 'styles/components/MemoryLegendElement.scss';
import { OperationDetails } from '../../model/OperationDetails';
import { MemoryLegendElement } from './MemoryLegendElement';
import Collapsible from '../Collapsible';

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
    return (
        <Collapsible
            isOpen={false}
            label={
                <div className='legend-element-container'>
                    <MemoryLegendElement
                        chunk={group[0]}
                        memSize={memSize}
                        selectedTensorAddress={selectedTensorAddress}
                        operationDetails={operationDetails}
                        onLegendClick={onLegendClick}
                    />
                    &nbsp;<strong>x{group.length}</strong>
                </div>
            }
        >
            <div className='grouped-legend-elements'>
                {group.slice(1).map((chunk: FragmentationEntry, index: number) => (
                    <MemoryLegendElement
                        chunk={chunk}
                        key={`${chunk.address}-${index}`}
                        memSize={memSize}
                        selectedTensorAddress={selectedTensorAddress}
                        operationDetails={operationDetails}
                        onLegendClick={onLegendClick}
                        isCondensed
                    />
                ))}
            </div>
        </Collapsible>
    );
};
