// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState } from 'react';
import classNames from 'classnames';
import { Button, Icon, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

import { useAtomValue } from 'jotai';
import { getTensorColor } from '../../functions/colorGenerator';
import { Tensor } from '../../model/APIData';
import { prettyPrintAddress, toHex, toReadableShape, toReadableType } from '../../functions/math';
import { BufferType, BufferTypeLabel } from '../../model/BufferType';
import { useOperationsList } from '../../hooks/useAPI';
import getNextAllocationOperation from '../../functions/getNextAllocationOperation';
import isValidNumber from '../../functions/isValidNumber';
import TensorVisualisationComponent from '../tensor-sharding-visualization/TensorVisualisationComponent';
import 'styles/components/TensorDetailsComponent.scss';
import { MAX_NUM_CONSUMERS } from '../../definitions/ProducersConsumers';
import GoldenTensorComparisonIndicator from '../GoldenTensorComparisonIndicator';
import { selectedTensorAtom } from '../../store/app';
import MemoryTag from '../MemoryTag';

export interface TensorDetailsComponentProps {
    tensor: Tensor;
    memorySize: number;
    onTensorClick: (address?: number, tensorId?: number) => void;
    operationId: number;
    zoomRange: [number, number];
}

const TensorDetailsComponent: React.FC<TensorDetailsComponentProps> = ({
    tensor,
    memorySize,
    onTensorClick,
    operationId,
    zoomRange,
}) => {
    const { address } = tensor;
    const { data: operations } = useOperationsList();
    const nextAllocationOperationId = operations ? getNextAllocationOperation(tensor, operations)?.id : null;
    const selectedTensorId = useAtomValue(selectedTensorAtom);

    const [overlayOpen, setOverlayOpen] = useState(false);

    const shardSpec = tensor.memory_config?.shard_spec;

    return (
        <div
            className={classNames('tensor-item', {
                active: tensor.id === selectedTensorId,
                dimmed: selectedTensorId !== null && tensor.id !== selectedTensorId,
            })}
        >
            <div className='tensor-header'>
                <button
                    type='button'
                    className='tensor-name'
                    onClick={() => onTensorClick(tensor.address ?? undefined, tensor.id)}
                >
                    <div
                        className={classNames('memory-color-block', {
                            'empty-tensor': tensor.address === null,
                        })}
                        style={{
                            backgroundColor: getTensorColor(tensor.id),
                        }}
                    />
                    <h4>Tensor ID: {tensor.id}</h4>
                    {tensor.operationIdentifier && <h5>{tensor.operationIdentifier}</h5>}
                </button>

                {(tensor.consumers.length > MAX_NUM_CONSUMERS || tensor.producers.length > MAX_NUM_CONSUMERS) && (
                    <Tooltip
                        content='Unusually high number of consumers'
                        position={PopoverPosition.TOP}
                        className='warning-icon'
                    >
                        <Icon
                            icon={IconNames.ISSUE}
                            intent={Intent.DANGER}
                            title='Unusually high number of consumers'
                        />
                    </Tooltip>
                )}

                {isValidNumber(nextAllocationOperationId) && isValidNumber(address) && operations ? (
                    <Tooltip
                        content={`Next allocation of ${toHex(address)} in ${nextAllocationOperationId} ${operations.find((operation) => operation.id === nextAllocationOperationId)?.name}(+${nextAllocationOperationId - operationId} operations)`}
                        placement={PopoverPosition.TOP}
                    >
                        <Icon
                            icon={IconNames.INFO_SIGN}
                            title={`Next allocation of ${toHex(address)} in ${nextAllocationOperationId} ${operations.find((operation) => operation.id === nextAllocationOperationId)?.name}(+${nextAllocationOperationId - operationId} operations)`}
                        />
                    </Tooltip>
                ) : null}

                {overlayOpen && address !== null && tensor.buffer_type !== null && (
                    <TensorVisualisationComponent
                        title={`${BufferTypeLabel[tensor.buffer_type]} ${toReadableShape(tensor.shape)} ${toReadableType(tensor.dtype)} ${tensor.operationIdentifier} Tensor ${tensor.id}`}
                        operationId={operationId}
                        address={address}
                        bufferType={tensor.buffer_type}
                        isOpen={overlayOpen}
                        onClose={() => setOverlayOpen(false)}
                        zoomRange={zoomRange}
                        tensorId={tensor.id}
                    />
                )}
            </div>

            <div className='tensor-meta'>
                <p>
                    Address: <strong> {prettyPrintAddress(tensor.address, memorySize)}</strong>
                </p>
                {tensor.buffer_type !== null && (
                    <p>
                        Buffer type: <MemoryTag memory={BufferTypeLabel[tensor.buffer_type]} />
                    </p>
                )}
                <p>
                    Shape:<strong> {toReadableShape(tensor.shape)}</strong>
                </p>
                <p>
                    Dtype:<strong> {toReadableType(tensor.dtype)}</strong>
                </p>
                <p>
                    Layout:<strong> {tensor.layout}</strong>
                </p>
                <p>
                    {tensor.memory_config?.memory_layout && (
                        <>
                            Memory layout:<strong> {tensor.memory_config.memory_layout}</strong>
                        </>
                    )}
                </p>
                {shardSpec ? (
                    <>
                        <p>
                            Sharding: <strong>{typeof shardSpec === 'string' ? shardSpec : null}</strong>
                        </p>

                        {typeof shardSpec === 'object' ? (
                            <ul className='shard-spec'>
                                {Object.entries(shardSpec).map(([prop, value]) => (
                                    <li key={value}>
                                        {prop}=<em>{typeof value !== 'string' ? JSON.stringify(value) : value}</em>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </>
                ) : null}
                {tensor.comparison?.global ? (
                    <>
                        <GoldenTensorComparisonIndicator
                            label='Actual PCC:'
                            value={tensor.comparison.global.actual_pcc}
                        />
                        <GoldenTensorComparisonIndicator
                            label='Desired PCC:'
                            value={tensor.comparison.global.desired_pcc}
                        />
                    </>
                ) : null}
                {tensor.buffer_type === BufferType.L1 && (
                    <Button
                        className='right-icon-small'
                        text='Tensor allocation per core'
                        icon={IconNames.FLOW_LINEAR}
                        intent={Intent.PRIMARY}
                        onClick={() => setOverlayOpen(true)}
                        endIcon={IconNames.OPEN_APPLICATION}
                    />
                )}
            </div>
        </div>
    );
};

export default TensorDetailsComponent;
