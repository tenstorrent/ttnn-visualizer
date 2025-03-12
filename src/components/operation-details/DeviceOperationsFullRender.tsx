// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { Fragment, JSX, useCallback } from 'react';
import { Icon, Intent, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai/index';
import classNames from 'classnames';
import { DeviceOperationTypes, Node, NodeType, Tensor } from '../../model/APIData';
import 'styles/components/DeviceOperationFullRender.scss';
import { MemoryLegendElement } from './MemoryLegendElement';
import { OperationDetails } from '../../model/OperationDetails';
import { selectedAddressAtom } from '../../store/app';
import Collapsible, { COLLAPSIBLE_EMPTY_CLASS } from '../Collapsible';
import { AllocationDetails, processMemoryAllocations } from '../../functions/processMemoryAllocations';
import { formatSize, getCoresInRange, prettyPrintAddress, toReadableShape } from '../../functions/math';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import MemoryTag from '../MemoryTag';
import { useGetTensorSizesById } from '../../hooks/useAPI';

// TODO: this component definitely needs to be broken down into smaller components

const DeviceOperationsFullRender: React.FC<{
    deviceOperations: Node[];
    details: OperationDetails;
    onLegendClick: (address: number, tensorId?: number) => void;
}> = ({ deviceOperations, details, onLegendClick }) => {
    const selectedAddress = useAtomValue(selectedAddressAtom);

    const inputIds = details.inputs.map((tensor) => tensor?.id);
    const inputs = useGetTensorSizesById(inputIds);
    const { memoryAllocationList, peakMemoryLoad } = processMemoryAllocations(deviceOperations, inputs);

    const formatDeviceOpParameters = useCallback(
        (node: Node) => {
            const bufferDetails = (buffer?: Node, tensorId?: number, optionalOutput?: JSX.Element | undefined) => {
                // TODO: this will need grouping of same sized buffers. its impractical to render 32 lines that are the same
                if (buffer === undefined) {
                    return null;
                }
                const { allocation } = buffer;
                let tensorSquare = null;
                const address =
                    allocation?.params.address === undefined ? undefined : parseInt(allocation.params.address, 10);
                if (address !== undefined || tensorId !== undefined) {
                    const tensor: Tensor | undefined =
                        address !== undefined
                            ? details.tensorListByAddress.get(address)
                            : Object.values(details.tensorListByAddress).find((t) => t.id === tensorId);
                    tensorSquare = (
                        <div
                            className={classNames('memory-color-block', {
                                'empty-tensor': address === null,
                            })}
                            style={{
                                backgroundColor:
                                    tensor?.id !== undefined || tensorId !== undefined
                                        ? getTensorColor(tensor?.id) || getTensorColor(tensorId)
                                        : getBufferColor(address || null),
                            }}
                        />
                    );
                }
                return (
                    <div
                        className='buffer-details'
                        key={buffer.id}
                    >
                        <span className='address'>
                            {tensorSquare} {address !== undefined && `${prettyPrintAddress(address, 0)}`}
                        </span>
                        <span> {formatSize(parseInt(buffer.params.size, 10))}</span>
                        <span>
                            <MemoryTag memory={buffer.params.type} />
                        </span>
                        {optionalOutput && optionalOutput}
                    </div>
                );
            };

            const createBuffersRender = (n: Node) => {
                const deviceIds = n.buffer?.filter((b) => b).map((b) => b.params.device_id) || [];
                if (deviceIds?.length > 1 && n.buffer !== undefined && n.buffer.length > 0) {
                    const buffer = n.buffer.find((b) => b);
                    return <>{bufferDetails(buffer, n.params.tensor_id, <strong>x{deviceIds.length}</strong>)}</>;
                }
                return n.buffer?.map((buffer, index) => (
                    <Fragment key={`buffer-details-${node.params.tensor_id} ${index}`}>
                        {bufferDetails(buffer, node.params.tensor_id)}
                    </Fragment>
                ));
            };

            if (node.node_type === NodeType.tensor) {
                const buffers = createBuffersRender(node);
                const layout = node.buffer?.[0]?.params.layout;
                const tensor = details.tensorList.find((t) => t.id === parseInt(node.params.tensor_id.toString(), 10));
                const square =
                    (tensor && (
                        <div
                            className={classNames('memory-color-block', {
                                'empty-tensor': tensor.address === null,
                            })}
                            style={{
                                backgroundColor: getTensorColor(parseInt(node.params.tensor_id.toString(), 10)),
                            }}
                        />
                    )) ||
                    null;
                const producer = tensor?.operationIdentifier || '';

                return buffers ? (
                    <Tooltip
                        content={
                            <div className='arg-tensor-tooltip'>
                                {buffers}
                                {layout && <span>{layout}</span>}
                                {producer && <span>{producer}</span>}
                            </div>
                        }
                        position='top'
                    >
                        <span className='standard-flex-layout'>
                            {square} Tensor {node.params.tensor_id} {toReadableShape(node.params.shape)}
                        </span>
                    </Tooltip>
                ) : (
                    <span className='standard-flex-layout'>
                        {square} Tensor {node.params.tensor_id} {toReadableShape(node.params.shape)}
                    </span>
                );
            }
            if (node.node_type === NodeType.circular_buffer_deallocate_all) {
                return '';
            }
            return node.node_type;
        },
        [details],
    );
    const preprocessConnections = useCallback((ops: Node[]) => {
        const captureStart = ops.find((op) => op.node_type === NodeType.capture_start);
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
                getConnectedNodes(op).forEach((n) => {
                    if (n.node_type === NodeType.function_end) {
                        n.operation = op;
                    }
                });
            } else if (op.node_type === NodeType.buffer) {
                const connectedNodes = getConnectedNodes(op);
                connectedNodes.forEach((n) => {
                    if (n.node_type === NodeType.tensor) {
                        n.params.device_id = op.params.device_id;
                        if (!n.buffer) {
                            n.buffer = [];
                        }
                        const deviceId = (op.params.device_id as number) || 0;
                        n.buffer[deviceId] = op;
                    }
                });
            } else if (op.node_type === NodeType.buffer_allocate) {
                const connectedNodes = getConnectedNodes(op);
                connectedNodes.forEach((n) => {
                    if (n.node_type === NodeType.buffer) {
                        const deviceId = (op.params.device_id as number) || 0;
                        const bufferDeviceId = (n.params.device_id as number) || 0;
                        if (deviceId === bufferDeviceId) {
                            n.allocation = op;
                        }
                        // n.params.device_id = op.params.device_id;
                        // if (!n.allocation) {
                        //     n.allocation = [];
                        // }
                        // n.allocation.push(op);
                    }
                });
            } else if (op.node_type === NodeType.circular_buffer_allocate) {
                const numCores = getCoresInRange(op.params.core_range_set);
                op.params.num_cores = numCores.toString();
            } else if (op.node_type !== NodeType.function_end && op.node_type !== NodeType.capture_start) {
                // inputs reversed
                const connectedNodes = getConnectedNodes(op);
                connectedNodes.forEach((n) => {
                    if (n.node_type === NodeType.function_start) {
                        n.inputs.push(op);
                    }
                });
            }
        });
        operations
            .filter((op) => op.node_type === NodeType.function_start)
            .filter((op) => !captureStart?.connections.includes(op.id))
            .forEach((op) => {
                op.outputs.forEach((n) => {
                    if (n.node_type === NodeType.tensor) {
                        if (n.params.device_id !== undefined) {
                            // KEEPING in case device id arrays confirmed
                            // op.params.derived_device_id = [
                            //     ...new Set(op.params.derived_device_id || [n.params.device_id]),
                            // ];
                            op.params.device_id = n.params.device_id;
                        }
                    }
                });
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
                            {/* DEBUGGING */}
                            {/* <span style={{ color: 'yellow' }}>{node.operation?.params.device_id}</span> */}
                            {opName} <DeviceID deviceId={node.operation?.params.device_id} /> (
                            {node.operation?.inputs.map((arg) => (
                                <span
                                    className='params'
                                    key={`${arg.id} ${node.id}`}
                                >
                                    {/* <span style={{ color: 'yellow' }}> */}
                                    {/*    id: {arg.id} {node.connections.join(',')} */}
                                    {/* </span> */}
                                    {formatDeviceOpParameters(arg)}
                                </span>
                            ))}
                            ) &nbsp;{' => '}
                            {node.operation?.outputs.map((arg) => (
                                <span
                                    className='params'
                                    key={`${arg.id} ${node.id}`}
                                >
                                    {/* <span style={{ color: 'yellow' }}> */}
                                    {/*    id: {arg.id} {node.connections.join(',')} */}
                                    {/* </span> */}
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
                                [COLLAPSIBLE_EMPTY_CLASS]: !hasContent,
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
                        const numCores = parseInt(buffer.num_cores, 10) || 1;
                        const bufferSize = parseInt(buffer.size, 10) / numCores;
                        operationContent = (
                            <DeviceOperationNode
                                _node={node}
                                memoryInfo={(buffer.type === DeviceOperationTypes.L1 && memoryInfo) || undefined}
                                key={index}
                                title='Buffer allocate'
                            >
                                <>
                                    {/* {buffer.type === DeviceOperationTypes.L1 && <pre>{JSON.stringify(buffer)}</pre>} */}
                                    <MemoryLegendElement
                                        chunk={{
                                            address: parseInt(buffer.address, 10),
                                            size: bufferSize,
                                        }}
                                        numCores={numCores}
                                        key={buffer.address}
                                        memSize={details.l1_sizes[0]}
                                        selectedTensorAddress={selectedAddress}
                                        operationDetails={details}
                                        onLegendClick={onLegendClick}
                                        bufferType={buffer.type}
                                        layout={buffer.layout}
                                    />
                                </>
                            </DeviceOperationNode>
                        );
                        // KEEPING
                        // } else if (nodeType === NodeType.buffer) {
                        //     const buffer = node.params;
                        //     operationContent = (
                        //         <DeviceOperationNode
                        //             _node={node}
                        //             memoryInfo={(buffer.type === DeviceOperationTypes.L1 && memoryInfo) || undefined}
                        //             key={index}
                        //             title={`Buffer ${formatSize(parseInt(buffer.size, 10))} ${buffer.type}`}
                        //         />
                        //     );
                    } else if (nodeType === NodeType.buffer_deallocate) {
                        const buffer = node.params;

                        const size = parseInt(buffer.size, 10);
                        const cores = parseInt(buffer.num_cores, 10) || 1;
                        const bufferSize = size / cores;
                        operationContent = (
                            <DeviceOperationNode
                                _node={node}
                                memoryInfo={(buffer.type === DeviceOperationTypes.L1 && memoryInfo) || undefined}
                                key={index}
                                title={`Buffer deallocate ${formatSize(bufferSize)} ${buffer.type} x ${cores}`}
                            />
                        );
                    } else if (nodeType === NodeType.circular_buffer_deallocate_all) {
                        operationContent = (
                            <DeviceOperationNode
                                _node={node}
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
                        const numCores = parseInt(cb.num_cores, 10) || 1;
                        operationContent = (
                            <Fragment key={`${cb.address}-${index}`}>
                                {!consecutiveCBsOutput && (
                                    <>
                                        <hr />
                                        <h4>CBs</h4>
                                    </>
                                )}
                                <MemoryLegendElement
                                    numCores={numCores}
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
        [
            details,
            formatDeviceOpParameters,
            memoryAllocationList,
            onLegendClick,
            peakMemoryLoad,
            preprocessConnections,
            selectedAddress,
        ],
    );

    return (
        <div className='device-operations-full-render-wrap'>
            <h3 className='peak-load monospace'>
                Peak L1 memory load per bank: <span className='format-numbers'>{formatSize(peakMemoryLoad)}</span>
            </h3>
            <div className='device-operations-full-render'>
                <span className='memory-info monospace '>
                    <span className='format-numbers'>CBs</span>
                    <span className='format-numbers'>Buffers</span>
                    <span className='format-numbers'>Total</span>
                </span>
                {renderOperations(deviceOperations)}
            </div>
            {/* we are rendering peak load twice if there are more than 20 device operations ei a lot of them */}
            {deviceOperations.length > 20 && (
                <h3 className='peak-load monospace'>
                    Peak L1 memory load per bank: <span className='format-numbers'>{formatSize(peakMemoryLoad)}</span>
                </h3>
            )}
        </div>
    );
};

export default DeviceOperationsFullRender;

const DeviceOperationNode: React.FC<
    React.PropsWithChildren<{
        title: string;
        memoryInfo?: JSX.Element;
        _node: Node;
    }>
> = ({ title, memoryInfo, _node, children }) => {
    return (
        <div className='device-operation'>
            <hr />
            <h4>
                {title}
                {/* DEBUGGING */}
                {/* <span style={{ color: 'yellow' }}> */}
                {/*    (id: {_node.id}) {_node.connections.join(',')} */}
                {/* </span> */}
                {memoryInfo}
            </h4>
            {children}
        </div>
    );
};

const DeviceID: React.FC<{ deviceId?: number | string }> = ({ deviceId }) => {
    return deviceId !== undefined && <span className='device-id'>{deviceId}</span>;
};
