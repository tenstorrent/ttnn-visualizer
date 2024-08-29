import React from 'react';
import classNames from 'classnames';
import { getBufferColor } from '../../functions/colorGenerator';
import { TensorData } from '../../model/APIData';
import { prettyPrintAddress } from '../../functions/math';
import { BufferTypeLabel } from '../../model/BufferType';

export interface TensorDetailsComponentProps {
    tensor: TensorData;
    selectedAddress: number | null;
    memorySize: number;
    onTensorClick: (tensorId: number) => void;
}

const TensorDetailsComponent: React.FC<TensorDetailsComponentProps> = ({
    tensor,
    selectedAddress = null,
    memorySize,
    onTensorClick,
}) => {
    return (
        <div
            className={classNames('tensor-item', {
                dimmed: tensor.address !== selectedAddress && selectedAddress !== null,
            })}
        >
            <button
                type='button'
                className='tensor-name'
                onClick={() => onTensorClick(tensor.id)}
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
