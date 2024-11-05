import React, { useState } from 'react';
import classNames from 'classnames';
import { Button, Icon, Intent, PopoverPosition, Position, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

import { getTensorColor } from '../../functions/colorGenerator';
import { TensorData } from '../../model/APIData';
import { prettyPrintAddress, toHex } from '../../functions/math';
import { BufferType, BufferTypeLabel } from '../../model/BufferType';
import { useOperationsList } from '../../hooks/useAPI';
import getDeallocationOperation from '../../functions/getDeallocationOperation';
import getNextAllocationOperation from '../../functions/getNextAllocationOperation';
import isValidNumber from '../../functions/isValidNumber';
import TensorVisualisationComponent from '../tensor-sharding-visualization/TensorVisualisationComponent';
import 'styles/components/TensorDetailsComponent.scss';

export interface TensorDetailsComponentProps {
    tensor: TensorData;
    selectedAddress: number | null;
    memorySize: number;
    onTensorClick: (address: number | null, tensorId: number) => void;
    operationId: number;
    zoomRange: [number, number];
}

const TensorDetailsComponent: React.FC<TensorDetailsComponentProps> = ({
    tensor,
    selectedAddress = null,
    memorySize,
    onTensorClick,
    operationId,
    zoomRange,
}) => {
    const { address } = tensor;
    const { data: operations } = useOperationsList();
    const nextAllocationOperationId = operations ? getNextAllocationOperation(tensor, operations)?.id : null;
    const deallocationOperationId = operations ? getDeallocationOperation(tensor, operations)?.id : null;

    const [overlayOpen, setOverlayOpen] = useState(false);

    return (
        <div
            className={classNames('tensor-item', {
                dimmed: tensor.address !== selectedAddress && selectedAddress !== null,
            })}
        >
            <div className='tensor-header'>
                <button
                    type='button'
                    className='tensor-name'
                    onClick={() => {
                        onTensorClick(tensor.address, tensor.id);
                    }}
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

                    <span className={classNames('format-numbers monospace', { em: tensor.address === null })}>
                        {prettyPrintAddress(tensor.address, memorySize)}
                    </span>
                </button>

                {isValidNumber(deallocationOperationId) && operations ? (
                    <Tooltip
                        content={`Deallocation in ${deallocationOperationId} ${operations.find((operation) => operation.id === deallocationOperationId)?.name}`}
                        placement={PopoverPosition.TOP}
                    >
                        <Icon
                            icon={IconNames.TICK}
                            intent={Intent.SUCCESS}
                        />
                    </Tooltip>
                ) : (
                    <Tooltip
                        content='Missing deallocation operation'
                        placement={PopoverPosition.TOP}
                    >
                        <Icon
                            icon={IconNames.WARNING_SIGN}
                            intent={Intent.WARNING}
                        />
                    </Tooltip>
                )}

                {isValidNumber(nextAllocationOperationId) && isValidNumber(address) && operations ? (
                    <Tooltip
                        content={`Next allocation of ${toHex(address)} in ${nextAllocationOperationId} ${operations.find((operation) => operation.id === nextAllocationOperationId)?.name}(+${nextAllocationOperationId - operationId} operations)`}
                        placement={PopoverPosition.TOP}
                    >
                        <Icon
                            icon={IconNames.INHERITANCE}
                            intent={Intent.PRIMARY}
                        />
                    </Tooltip>
                ) : null}

                {tensor.buffer_type === BufferType.L1 && (
                    <Tooltip
                        content={`Visualize tensor ${tensor.id}`}
                        placement={Position.TOP}
                    >
                        <Button
                            icon={tensor.io === 'input' ? IconNames.FLOW_END : IconNames.FLOW_LINEAR}
                            minimal
                            small
                            intent={Intent.SUCCESS}
                            onClick={() => setOverlayOpen(true)}
                        />
                    </Tooltip>
                )}
                {overlayOpen && address !== null && tensor.buffer_type !== null && (
                    <TensorVisualisationComponent
                        title={`Tensor ${tensor.id}`}
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
                {tensor.buffer_type !== null && <p>Buffer type: {BufferTypeLabel[tensor.buffer_type]}</p>}
                <p>Shape: {tensor.shape}</p>
                <p>Dtype: {tensor.dtype}</p>
                <p>Layout: {tensor.layout}</p>
            </div>
        </div>
    );
};

export default TensorDetailsComponent;
