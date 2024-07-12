import React from 'react';
import classNames from 'classnames';
import { getBufferColor } from '../../functions/colorGenerator';
import { TensorData } from '../../model/APIData';
import { prettyPrintAddress } from '../../functions/math';

export interface TensorDetailsComponentProps {
    tensor: TensorData;
    selectedAddress: number | null;
    memorySize: number;
}

const TensorDetailsComponent: React.FC<TensorDetailsComponentProps> = ({
    tensor,
    selectedAddress = null,
    memorySize,
}) => {
    return (
        <div
            className={classNames('tensor-item', {
                dimmed: tensor.address !== selectedAddress && selectedAddress !== null,
            })}
        >
            <div className='tensor-name'>
                <div
                    className={classNames('memory-color-block', {
                        'empty-tensor': tensor.address === null,
                    })}
                    style={{
                        backgroundColor: getBufferColor(tensor.address, tensor.tensor_id),
                    }}
                />
                <h4>Tensor ID: {tensor.tensor_id}</h4>

                <span className='format-numbers'>{prettyPrintAddress(tensor.address, memorySize)}</span>
            </div>

            <div className='tensor-meta'>
                <p>Shape: {tensor.shape}</p>
                <p>Dtype: {tensor.dtype}</p>
                <p>Layout: {tensor.layout}</p>
            </div>
        </div>
    );
};

export default TensorDetailsComponent;
