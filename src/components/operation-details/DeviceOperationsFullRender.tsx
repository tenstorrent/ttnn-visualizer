// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React, { JSX } from 'react';
import { Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai/index';
import { Node, NodeType } from '../../model/APIData';
import 'styles/components/DeviceOperationFullRender.scss';
import { MemoryLegendElement } from './MemoryLegendElement';
import { OperationDetails } from '../../model/OperationDetails';
import { selectedAddressAtom } from '../../store/app';
import Collapsible, { COLLAPSIBLE_EMPTY_CLASS } from '../Collapsible';
import { calculateL1MemoryUsage, processAllocations } from '../../functions/calculateMemoryPeakLoad';
import { formatSize } from '../../functions/math';

const DeviceOperationsFullRender: React.FC<{
    deviceOperations: Node[];
    details: OperationDetails;
    onLegendClick: (address: number, tensorId?: number) => void;
}> = ({ deviceOperations, details, onLegendClick }) => {
    const deviceOpList: Node[] = [];
    const selectedAddress = useAtomValue(selectedAddressAtom);
    const renderOperations = (operations: Node[]) => {
        const processedData = processAllocations(operations);

        const stack: JSX.Element[][] = [];
        const output: JSX.Element[] = [];
        let consecutiveCBsOutput: boolean = false;
        operations.forEach((node, index) => {
            const nodeType = node.node_type;

            const memoryDetails = processedData.find((data) => data.id === node.id);

            const memoryInfo = memoryDetails ? (
                <span className='memory-info monospace '>
                    <span className='format-numbers'>{formatSize(memoryDetails.total_cb)}</span>
                    <span className='format-numbers'>{formatSize(memoryDetails.total_buffer)}</span>
                    <span className='format-numbers'>{formatSize(memoryDetails.total_memory)}</span>
                </span>
            ) : undefined;
            if (nodeType === NodeType.function_start) {
                deviceOpList.push(node);
                stack.push([]);
            } else if (nodeType === NodeType.function_end) {
                const innerContent = stack.pop();
                const label = (
                    <h4>
                        <Icon
                            className='operation-icon'
                            size={13}
                            intent={Intent.SUCCESS}
                            icon={IconNames.CUBE_ADD}
                        />
                        {node.params.name}
                    </h4>
                );

                const hasContent = innerContent && innerContent.length > 0;
                const completedBlock = (
                    <Collapsible
                        key={`end-${index}`}
                        label={label}
                        collapseClassName={`device-operation function-container ${!hasContent && COLLAPSIBLE_EMPTY_CLASS}`}
                    >
                        <div className='function-content'>{innerContent}</div>
                        <div>END OP:</div>
                        {memoryInfo}
                    </Collapsible>
                );

                if (stack.length > 0) {
                    stack[stack.length - 1].push(completedBlock);
                } else {
                    output.push(completedBlock);
                }
            } else {
                let operationContent: JSX.Element | null = null;

                if (nodeType === NodeType.buffer_allocate) {
                    const buffer = node.params;
                    operationContent = (
                        <DeviceOperationNode
                            memoryInfo={memoryInfo}
                            key={index}
                            title='Buffer allocate'
                        >
                            <MemoryLegendElement
                                chunk={{ address: parseInt(buffer.address, 10), size: parseInt(buffer.size, 10) }}
                                key={buffer.address}
                                memSize={details.l1_sizes[0]}
                                selectedTensorAddress={selectedAddress}
                                operationDetails={details}
                                onLegendClick={onLegendClick}
                                bufferType={buffer.type}
                                layout={buffer.layout}
                            />
                        </DeviceOperationNode>
                    );
                } else if (nodeType === NodeType.buffer) {
                    const buffer = node.params;
                    operationContent = (
                        <DeviceOperationNode
                            memoryInfo={memoryInfo}
                            key={index}
                            title={`Buffer ${buffer.size} ${buffer.type} ${buffer.layout}`}
                        />
                    );
                } else if (nodeType === NodeType.buffer_deallocate) {
                    const buffer = node.params;
                    operationContent = (
                        <DeviceOperationNode
                            memoryInfo={memoryInfo}
                            key={index}
                            title='Buffer deallocate'
                        >
                            <p>
                                {buffer.size} {buffer.type} {buffer.layout}
                            </p>
                        </DeviceOperationNode>
                    );
                } else if (nodeType === NodeType.circular_buffer_deallocate_all) {
                    operationContent = (
                        <DeviceOperationNode
                            memoryInfo={memoryInfo}
                            key={index}
                            title='Circular buffer deallocate all'
                        />
                    );
                } else if (nodeType === NodeType.tensor) {
                    const tensorData = node.params;
                    operationContent = (
                        <DeviceOperationNode
                            memoryInfo={memoryInfo}
                            key={index}
                            title='Tensor'
                        >
                            <p>
                                <strong>ID:</strong> {tensorData.tensor_id} {tensorData.shape}
                            </p>
                        </DeviceOperationNode>
                    );
                } else if (nodeType === NodeType.circular_buffer_allocate) {
                    const cb = node.params;
                    operationContent = (
                        <>
                            {!consecutiveCBsOutput && <h4>CBs</h4>}
                            <MemoryLegendElement
                                chunk={{ address: parseInt(cb.address, 10), size: parseInt(cb.size, 10) }}
                                key={cb.address}
                                memSize={details.l1_sizes[0]} // TODO: fix to device specific value
                                selectedTensorAddress={selectedAddress}
                                operationDetails={details}
                                onLegendClick={onLegendClick}
                                colorVariance={deviceOpList.at(-1)?.id}
                            />
                            <br />
                        </>
                    );
                    consecutiveCBsOutput = true;
                }
                if (nodeType !== NodeType.circular_buffer_allocate) {
                    consecutiveCBsOutput = false;
                }
                if (operationContent) {
                    if (stack.length > 0) {
                        stack[stack.length - 1].push(operationContent);
                    } else {
                        output.push(operationContent);
                    }
                }
            }
        });

        return output;
    };

    const memoryLoad = formatSize(calculateL1MemoryUsage(deviceOperations));
    return (
        <>
            <h3 className='monospace'>Peak memory load: {memoryLoad}</h3>
            <div className='device-operations-full-render'>{renderOperations(deviceOperations)}</div>
        </>
    );
};

export default DeviceOperationsFullRender;

const DeviceOperationNode: React.FC<React.PropsWithChildren<{ title: string; memoryInfo?: JSX.Element }>> = ({
    title,
    memoryInfo,
    children,
}) => {
    return (
        <div className='device-operation'>
            <h4>
                {title} {memoryInfo}
            </h4>

            {children}
        </div>
    );
};
