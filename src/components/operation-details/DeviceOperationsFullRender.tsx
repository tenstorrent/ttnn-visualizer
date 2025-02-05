// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { Fragment, JSX, useCallback } from 'react';
import { Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai/index';
import classNames from 'classnames';
import { DeviceOperationTypes, Node, NodeType } from '../../model/APIData';
import 'styles/components/DeviceOperationFullRender.scss';
import { MemoryLegendElement } from './MemoryLegendElement';
import { OperationDetails } from '../../model/OperationDetails';
import { selectedAddressAtom } from '../../store/app';
import Collapsible from '../Collapsible';
import { AllocationDetails, processMemoryAllocations } from '../../functions/processMemoryAllocations';
import { formatSize, toReadableShape } from '../../functions/math';

const DeviceOperationsFullRender: React.FC<{
    deviceOperations: Node[];
    details: OperationDetails;
    onLegendClick: (address: number, tensorId?: number) => void;
}> = ({ deviceOperations, details, onLegendClick }) => {
    const selectedAddress = useAtomValue(selectedAddressAtom);
    const { memoryAllocationList, peakMemoryLoad } = processMemoryAllocations(deviceOperations);

    const formatDeviceOpParameters = (node: Node) => {
        if (node.node_type === NodeType.tensor) {
            return (
                <span>
                    Tensor {node.params.tensor_id} {toReadableShape(node.params.shape)}
                </span>
            );
        }
        if (node.node_type === NodeType.circular_buffer_deallocate_all) {
            return '';
        }
        return node.node_type;
    };

    const preprocessConnections = useCallback((ops: Node[]) => {
        const operations: Node[] = ops.map((op) => ({ ...op, inputs: [], outputs: [] }));
        const getConnectedNodes = (node: Node): Node[] => {
            return node.connections
                .map((connection) => {
                    return operations.find((connectedNode) => connectedNode.id === connection);
                })
                .filter((n) => n) as Node[];
        };
        operations.forEach((op) => {
            if (op.node_type === NodeType.function_start) {
                // outputs
                op.outputs = getConnectedNodes(op).flatMap((node) => {
                    if (node?.node_type === NodeType.function_end) {
                        return getConnectedNodes(node).filter(
                            (out) =>
                                out?.node_type !== NodeType.capture_end && out?.node_type !== NodeType.function_start,
                        );
                    }
                    return [];
                });
                // connect end to start
                getConnectedNodes(op).forEach((node) => {
                    if (node.node_type === NodeType.function_end) {
                        node.operation = op;
                    }
                });
            } else if (op.node_type !== NodeType.function_end && op.node_type !== NodeType.capture_start) {
                // inputs reversed
                const connectedNodes = getConnectedNodes(op);
                connectedNodes.forEach((node) => {
                    if (node.node_type === NodeType.function_start) {
                        node.inputs.push(op);
                    }
                });
            }
        });
        return operations;
    }, []);

    const renderOperations = useCallback(
        (ops: Node[]) => {
            const deviceOpList: Node[] = [];
            const operations = preprocessConnections(ops);
            const stack: JSX.Element[][] = [];
            const output: JSX.Element[] = [];
            let consecutiveCBsOutput: boolean = false;
            operations.forEach((node, index) => {
                const nodeType = node.node_type;
                const memoryDetails: AllocationDetails | undefined = memoryAllocationList.find(
                    (data) => data.id === node.id,
                );
                const memoryInfo = memoryDetails ? (
                    <span
                        className={classNames('memory-info monospace', {
                            peak: memoryDetails.total_memory === peakMemoryLoad,
                        })}
                    >
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
                    const opName = node.params.name;
                    // const mem = operationMemoryDetails.pop();
                    const label = (
                        <h4>
                            <Icon
                                className='operation-icon'
                                size={13}
                                intent={Intent.SUCCESS}
                                icon={IconNames.CUBE_ADD}
                            />
                            {opName} (
                            {node.operation?.inputs.map((arg) => (
                                <span
                                    className='params'
                                    key={arg.id}
                                >
                                    {formatDeviceOpParameters(arg)}
                                </span>
                            ))}
                            ) &nbsp;{' => '}
                            {node.operation?.outputs.map((arg) => (
                                <span
                                    className='params'
                                    key={arg.id}
                                >
                                    {formatDeviceOpParameters(arg)}
                                </span>
                            ))}
                        </h4>
                    );

                    const hasContent = innerContent && innerContent.length > 0;

                    const completedBlock = (
                        <Collapsible
                            key={`end-${index}`}
                            label={label}
                            isOpen
                            collapseClassName={classNames('device-operation function-container', {
                                COLLAPSIBLE_EMPTY_CLASS: !hasContent,
                            })}
                        >
                            <div className='function-content'>{innerContent}</div>
                            <div className='end-function'>
                                {/* staying for now */}
                                {/* <Icon */}
                                {/*    className='operation-icon' */}
                                {/*    title={opName} */}
                                {/*    size={13} */}
                                {/*    intent={Intent.SUCCESS} */}
                                {/*    icon={IconNames.CUBE} */}
                                {/* /> */}
                            </div>
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
                                memoryInfo={(buffer.type === DeviceOperationTypes.L1 && memoryInfo) || undefined}
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
                                memoryInfo={(buffer.type === DeviceOperationTypes.L1 && memoryInfo) || undefined}
                                key={index}
                                title={`Buffer ${formatSize(parseInt(buffer.size, 10))} ${buffer.type}`}
                            />
                        );
                    } else if (nodeType === NodeType.buffer_deallocate) {
                        const buffer = node.params;
                        operationContent = (
                            <DeviceOperationNode
                                memoryInfo={(buffer.type === DeviceOperationTypes.L1 && memoryInfo) || undefined}
                                key={index}
                                title={`Buffer deallocate ${formatSize(parseInt(operations[node.connections[0]].params.size, 10))} ${buffer.type}`}
                            />
                        );
                    } else if (nodeType === NodeType.circular_buffer_deallocate_all) {
                        operationContent = (
                            <DeviceOperationNode
                                memoryInfo={memoryInfo}
                                key={index}
                                title='Circular buffer deallocate all'
                            />
                        );
                        // PLO
                        // } else if (nodeType === NodeType.tensor) {
                        //     const tensorData = node.params;
                        //     operationContent = (
                        //         <DeviceOperationNode
                        //             memoryInfo={memoryInfo}
                        //             key={index}
                        //             title='Tensor'
                        //         >
                        //             <p>
                        //                 <strong>ID:</strong> {tensorData.tensor_id} {tensorData.shape}
                        //             </p>
                        //         </DeviceOperationNode>
                        //     );
                    } else if (nodeType === NodeType.circular_buffer_allocate) {
                        const cb = node.params;
                        operationContent = (
                            <Fragment key={`${cb.address}-${index}`}>
                                {!consecutiveCBsOutput && (
                                    <>
                                        <hr />
                                        <h4>CBs</h4>
                                    </>
                                )}
                                <MemoryLegendElement
                                    chunk={{ address: parseInt(cb.address, 10), size: parseInt(cb.size, 10) }}
                                    memSize={details.l1_sizes[0]} // TODO: fix to device specific value
                                    selectedTensorAddress={selectedAddress}
                                    operationDetails={details}
                                    onLegendClick={onLegendClick}
                                    colorVariance={deviceOpList.at(-1)?.id}
                                />
                                {memoryInfo}
                                <br />
                            </Fragment>
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
        },
        [details, memoryAllocationList, onLegendClick, peakMemoryLoad, preprocessConnections, selectedAddress],
    );

    return (
        <div className='device-operations-full-render-wrap'>
            <h3 className='peak-load monospace'>
                Peak L1 memory load: <span className='format-numbers'>{formatSize(peakMemoryLoad)}</span>
            </h3>
            <div className='device-operations-full-render'>
                <span className='memory-info monospace '>
                    <span className='format-numbers'>CBs</span>
                    <span className='format-numbers'>Buffers</span>
                    <span className='format-numbers'>Total</span>
                </span>
                {renderOperations(deviceOperations)}
            </div>
            {deviceOperations.length > 20 && (
                <h3 className='peak-load monospace'>
                    Peak L1 memory load: <span className='format-numbers'>{formatSize(peakMemoryLoad)}</span>
                </h3>
            )}
        </div>
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
            <hr />
            <h4>
                {title} {memoryInfo}
            </h4>
            {children}
        </div>
    );
};
