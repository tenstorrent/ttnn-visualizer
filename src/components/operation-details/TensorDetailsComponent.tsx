import React, { useState } from 'react';
import classNames from 'classnames';
import { Button, Icon, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { getTensorColor } from '../../functions/colorGenerator';
import { TensorData } from '../../model/APIData';
import { prettyPrintAddress, toHex } from '../../functions/math';
import { BufferTypeLabel } from '../../model/BufferType';
import { useOperationsList } from '../../hooks/useAPI';
import getDeallocationOperation from '../../functions/getDeallocationOperation';
import getNextAllocationOperation from '../../functions/getNextAllocationOperation';
import isValidNumber from '../../functions/isValidNumber';
import TensorVisualisationComponent from '../tensor-sharding-visualization/TensorVisualisationComponent';

export interface TensorDetailsComponentProps {
    tensor: TensorData;
    selectedAddress: number | null;
    memorySize: number;
    onTensorClick: (tensorId: number | null) => void;
    operationId: number;
}

const TensorDetailsComponent: React.FC<TensorDetailsComponentProps> = ({
    tensor,
    selectedAddress = null,
    memorySize,
    onTensorClick,
    operationId,
}) => {
    const { address } = tensor;
    const { data: operations } = useOperationsList();
    const nextAllocationOperationId = operations ? getNextAllocationOperation(tensor, operations)?.id : null;
    const deallocationOperationId = operations ? getDeallocationOperation(tensor, operations)?.id : null;

    const [overlayOpen, setOverlayOpen] = useState(false);

    const openTensorVisualization = (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();
        setOverlayOpen(true);
    };

    return (
        <div
            className={classNames('tensor-item', {
                dimmed: tensor.address !== selectedAddress && selectedAddress !== null,
            })}
        >
            {overlayOpen && address !== null && tensor.buffer_type !== null && (
                <TensorVisualisationComponent
                    operationId={operationId}
                    address={address}
                    bufferType={tensor.buffer_type}
                    isOpen={overlayOpen}
                    onClose={() => setOverlayOpen(false)}
                />
            )}
            <button
                type='button'
                className='tensor-name'
                onClick={() => onTensorClick(tensor.address)}
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

                <span className='format-numbers monospace'>{prettyPrintAddress(tensor.address, memorySize)}</span>

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
                        // @ts-expect-error - nextAllocationOperationId is a number
                        content={`Next allocation of ${toHex(address)} in ${nextAllocationOperationId} ${operations.find((operation) => operation.id === nextAllocationOperationId)?.name}(+${nextAllocationOperationId - operationId} operations)`}
                        placement={PopoverPosition.TOP}
                    >
                        <Icon
                            icon={IconNames.INHERITANCE}
                            intent={Intent.PRIMARY}
                        />
                    </Tooltip>
                ) : null}
                <Button
                    title={`Visualize tensor ${tensor.id}`}
                    icon={IconNames.EYE_OPEN}
                    minimal
                    small
                    onClick={(e) => openTensorVisualization(e)}
                />
            </button>

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
