// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { Fragment, JSX, useCallback } from 'react';
import { Classes, Icon, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai';
import classNames from 'classnames';
import { DeviceOperationTypes, Node, NodeType, Tensor } from '../../model/APIData';
import 'styles/components/DeviceOperationFullRender.scss';
import { MemoryLegendElement } from './MemoryLegendElement';
import { OperationDetails } from '../../model/OperationDetails';
import { selectedAddressAtom } from '../../store/app';
import Collapsible, { COLLAPSIBLE_EMPTY_CLASS } from '../Collapsible';
import { AllocationDetails, processMemoryAllocations } from '../../functions/processMemoryAllocations';
import { formatMemorySize, prettyPrintAddress } from '../../functions/math';
import { L1_DEFAULT_MEMORY_SIZE, L1_NUM_CORES } from '../../definitions/L1MemorySize';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import MemoryTag from '../MemoryTag';
import { toReadableShape } from '../../functions/formatting';

type BufferDetails = {
    buffer?: Node;
    tensorId?: number;
    optionalOutput?: JSX.Element;
    details: OperationDetails;
};

const renderBufferDetails = ({ buffer, tensorId, optionalOutput, details }: BufferDetails) => {
    // TODO: this will need grouping of same sized buffers. its impractical to render 32 lines that are the same
    if (buffer === undefined) {
        return null;
    }

    const { allocation } = buffer;

    let tensorSquare = null;
    const address = allocation?.params.address === undefined ? undefined : parseInt(allocation.params.address, 10);

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
            <span> {formatMemorySize(parseInt(buffer.params.size, 10), 2)}</span>
            <span>
                <MemoryTag memory={buffer.params.type} />
            </span>
            {optionalOutput && optionalOutput}
        </div>
    );
};

const renderTensorLabel = (node: Node, details: OperationDetails, buffers: JSX.Element | JSX.Element[] | null) => {
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
            position={PopoverPosition.TOP}
        >
            <span className='standard-flex-layout'>
                {square}{' '}
                <span className={classNames(Classes.TOOLTIP_INDICATOR, 'has-tooltip')}>
                    Tensor {node.params.tensor_id} {toReadableShape(node.params.shape)}
                </span>
            </span>
        </Tooltip>
    ) : (
        <span className='standard-flex-layout'>
            {square} Tensor {node.params.tensor_id} {toReadableShape(node.params.shape)}
        </span>
    );
};

function createBuffersRender(node: Node, details: OperationDetails) {
    const deviceIds = node.buffer?.filter((b) => b).map((b) => b.params.device_id) || [];

    if (deviceIds?.length > 1 && node.buffer !== undefined && node.buffer.length > 0) {
        const buffer = node.buffer.find((b) => b);
        return (
            <>
                {renderBufferDetails({
                    buffer,
                    tensorId: node.params.tensor_id,
                    optionalOutput: <strong>x{deviceIds.length}</strong>,
                    details,
                })}
            </>
        );
    }

    return (
        node.buffer?.map((buffer, index) => (
            <Fragment key={`buffer-details-${node.params.tensor_id} ${index}`}>
                {renderBufferDetails({ buffer, tensorId: node.params.tensor_id, details })}
            </Fragment>
        )) || null
    );
}

function formatDeviceOpParametersImpl(node: Node, details: OperationDetails) {
    if (node.node_type === NodeType.tensor) {
        const buffers = node.buffer ? createBuffersRender(node, details) : null;
        return renderTensorLabel(node, details, buffers);
    }

    if (node.node_type === NodeType.circular_buffer_deallocate_all) {
        return '';
    }

    return node.node_type;
}

const renderMemoryInfo = (
    memoryDetails: AllocationDetails | undefined,
    peakMemoryLoad: number,
): JSX.Element | undefined => {
    if (!memoryDetails) {
        return undefined;
    }

    return (
        <span
            className={classNames('memory-info monospace', {
                peak: memoryDetails.total_memory === peakMemoryLoad,
            })}
        >
            <span className='format-numbers'>{formatMemorySize(memoryDetails.total_cb, 2)}</span>
            <span className='format-numbers'>{formatMemorySize(memoryDetails.total_buffer, 2)}</span>
            <span className='format-numbers'>{formatMemorySize(memoryDetails.total_memory, 2)}</span>
        </span>
    );
};

function useDeviceOperationsFullRenderModel(args: {
    deviceOperations: Node[];
    details: OperationDetails;
    onLegendClick: (address: number, tensorId?: number) => void;
}) {
    const { deviceOperations, details, onLegendClick } = args;

    const selectedAddress = useAtomValue(selectedAddressAtom);
    const { memoryAllocationList, peakMemoryLoad } = processMemoryAllocations(deviceOperations);

    const formatDeviceOpParameters = useCallback(
        (node: Node) => formatDeviceOpParametersImpl(node, details),
        [details],
    );

    const renderOperations = useCallback(
        (ops: Node[]) => {
            const deviceOpList: Node[] = [];
            const stack: JSX.Element[][] = [];
            const output: JSX.Element[] = [];
            let consecutiveCBsOutput = false;

            ops.forEach((node, index) => {
                const nodeType = node.node_type;

                const memoryDetails = memoryAllocationList.find((data) => data.id === node.id);
                const memoryInfo = renderMemoryInfo(memoryDetails, peakMemoryLoad);

                if (nodeType === NodeType.function_start) {
                    deviceOpList.push(node);
                    stack.push([]);
                    return;
                }

                if (nodeType === NodeType.function_end) {
                    const innerContent = stack.pop();
                    const opName = node.params.name;

                    const label = (
                        <h4>
                            <Icon
                                className='operation-icon'
                                size={13}
                                intent={Intent.SUCCESS}
                                icon={IconNames.CUBE_ADD}
                            />
                            {opName} <DeviceID _deviceId={node.operation?.params.device_id} /> (
                            {node.operation?.inputs.map((arg) => (
                                <span
                                    className='params'
                                    key={`${arg.id} ${node.id}`}
                                >
                                    {formatDeviceOpParameters(arg)}
                                </span>
                            ))}
                            ) &nbsp;{' => '}
                            {node.operation?.outputs.map((arg) => (
                                <span
                                    className='params'
                                    key={`${arg.id} ${node.id}`}
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
                                [COLLAPSIBLE_EMPTY_CLASS]: !hasContent,
                            })}
                        >
                            <div className='function-content'>{innerContent}</div>
                            <div className='end-function'>{/* staying for now */}</div>
                        </Collapsible>
                    );

                    if (stack.length > 0) {
                        stack[stack.length - 1].push(completedBlock);
                    } else {
                        output.push(completedBlock);
                    }
                    return;
                }

                let operationContent: JSX.Element | null = null;

                if (nodeType === NodeType.buffer_allocate) {
                    const buffer = node.params;
                    const defaultNumberCores = buffer.type === DeviceOperationTypes.L1 ? L1_NUM_CORES : 1;
                    const cores = parseInt(buffer.num_cores, 10) || defaultNumberCores;
                    const bufferSize = parseInt(buffer.size, 10) / cores;

                    operationContent = (
                        <DeviceOperationNode
                            _node={node}
                            memoryInfo={(buffer.type === DeviceOperationTypes.L1 && memoryInfo) || undefined}
                            key={index}
                            title='Buffer allocate'
                        >
                            <MemoryLegendElement
                                chunk={{
                                    address: parseInt(buffer.address, 10),
                                    size: bufferSize,
                                }}
                                numCores={cores}
                                key={buffer.address}
                                memSize={details.l1_sizes[0] || L1_DEFAULT_MEMORY_SIZE}
                                selectedTensorAddress={selectedAddress}
                                operationDetails={details}
                                onLegendClick={onLegendClick}
                                bufferType={buffer.type}
                                layout={buffer.layout}
                            />
                        </DeviceOperationNode>
                    );
                } else if (nodeType === NodeType.buffer_deallocate) {
                    const buffer = node.params;
                    const size = parseInt(buffer.size, 10);
                    const defaultNumberCores = buffer.type === DeviceOperationTypes.L1 ? L1_NUM_CORES : 1;
                    const cores = parseInt(buffer.num_cores, 10) || defaultNumberCores;
                    const bufferSize = size / cores;

                    operationContent = (
                        <DeviceOperationNode
                            _node={node}
                            memoryInfo={(buffer.type === DeviceOperationTypes.L1 && memoryInfo) || undefined}
                            key={index}
                            title={`Buffer deallocate ${formatMemorySize(bufferSize)} ${buffer.type} x ${cores} cores`}
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
                                memSize={details.l1_sizes[0] || L1_DEFAULT_MEMORY_SIZE}
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
            });

            return output;
        },
        [details, formatDeviceOpParameters, memoryAllocationList, onLegendClick, peakMemoryLoad, selectedAddress],
    );

    return {
        selectedAddress,
        memoryAllocationList,
        peakMemoryLoad,
        renderOperations,
    };
}

const DeviceOperationsFullRender: React.FC<{
    deviceOperations: Node[];
    details: OperationDetails;
    onLegendClick: (address: number, tensorId?: number) => void;
}> = ({ deviceOperations, details, onLegendClick }) => {
    const { peakMemoryLoad, renderOperations } = useDeviceOperationsFullRenderModel({
        deviceOperations,
        details,
        onLegendClick,
    });

    return (
        <div className='device-operations-full-render-wrap'>
            <h3 className='peak-load monospace'>
                Peak L1 memory load per core:{' '}
                <span className='format-numbers'>{formatMemorySize(peakMemoryLoad, 2)}</span>
            </h3>
            <div className='device-operations-full-render'>
                <span className='memory-info monospace'>
                    <span className='format-numbers'>CBs</span>
                    <span className='format-numbers'>Buffers</span>
                    <span className='format-numbers'>Total</span>
                </span>
                {renderOperations(deviceOperations)}
            </div>
            {deviceOperations.length > 20 && (
                <h3 className='peak-load monospace'>
                    Peak L1 memory load per core:{' '}
                    <span className='format-numbers'>{formatMemorySize(peakMemoryLoad, 2)}</span>
                </h3>
            )}
        </div>
    );
};

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

const DeviceID: React.FC<{ _deviceId?: number | string }> = ({ _deviceId }) => {
    return null;
    // PLO, debugging code
    // return _deviceId !== undefined && <span className='device-id'>{_deviceId}</span>;
};

export default DeviceOperationsFullRender;
