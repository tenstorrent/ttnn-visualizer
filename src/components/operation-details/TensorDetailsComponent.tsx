import React from 'react';
import classNames from 'classnames';
import { Icon, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { getBufferColor } from '../../functions/colorGenerator';
import { TensorData } from '../../model/APIData';
import { prettyPrintAddress, toHex } from '../../functions/math';
import { BufferTypeLabel } from '../../model/BufferType';
import { useNextBuffer, useOperationsList } from '../../hooks/useAPI';
import getDeallocationOperation from '../../functions/getDeallocationOperation';

export interface TensorDetailsComponentProps {
    tensor: TensorData;
    selectedAddress: number | null;
    memorySize: number;
    onTensorClick: (tensorId: number | null) => void;
}

const TensorDetailsComponent: React.FC<TensorDetailsComponentProps> = ({
    tensor,
    selectedAddress = null,
    memorySize,
    onTensorClick,
}) => {
    const { id, address, consumers } = tensor;
    const { data: operations } = useOperationsList();
    const { data: buffer, isLoading } = useNextBuffer(address, consumers, id.toString());
    const deallocationOperationId = operations ? getDeallocationOperation(tensor, operations) : null;

    return (
        <div
            className={classNames('tensor-item', {
                dimmed: tensor.address !== selectedAddress && selectedAddress !== null,
            })}
        >
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
                        backgroundColor: getBufferColor(tensor.address),
                    }}
                />
                <h4>Tensor ID: {tensor.id}</h4>

                <span className='format-numbers monospace'>{prettyPrintAddress(tensor.address, memorySize)}</span>

                {Number.isFinite(deallocationOperationId) && operations ? (
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

                {buffer?.next_usage && address && operations && !isLoading ? (
                    <Tooltip
                        content={`Next allocation of ${toHex(address)} in ${buffer.operation_id} ${operations.find((operation) => operation.id === buffer.operation_id)?.name} (+${buffer.next_usage} operations)`}
                        placement={PopoverPosition.TOP}
                    >
                        <Icon
                            icon={IconNames.INHERITANCE}
                            intent={Intent.PRIMARY}
                        />
                    </Tooltip>
                ) : null}
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
