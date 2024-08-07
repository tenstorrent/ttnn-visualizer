import React from 'react';
import classNames from 'classnames';
import { FragmentationEntry } from '../../model/APIData';
import { OperationDetails } from '../../model/OperationDetails';
import { getBufferColor } from '../../functions/colorGenerator';
import { formatSize, prettyPrintAddress, toHex } from '../../functions/math';

export const MemoryLegendElement: React.FC<{
    chunk: FragmentationEntry;
    memSize: number;
    selectedTensorAddress: number | null;
    operationDetails: OperationDetails;
}> = ({
    //
    chunk,
    memSize,
    selectedTensorAddress,
    operationDetails,
}) => {
    return (
        <div
            key={chunk.address}
            className={classNames('legend-item', {
                dimmed: selectedTensorAddress !== null && selectedTensorAddress !== chunk.address,
            })}
        >
            <div
                className={classNames('memory-color-block', {
                    empty: chunk.empty === true,
                })}
                style={{
                    backgroundColor: chunk.empty ? '#fff' : getBufferColor(chunk.address),
                }}
            />
            <div className='legend-details'>
                <div className='format-numbers'>{prettyPrintAddress(chunk.address, memSize)}</div>
                <div className='format-numbers keep-left'>({toHex(chunk.address)})</div>
                <div className='format-numbers'>{formatSize(chunk.size)} </div>
                <div>
                    {!chunk.empty && operationDetails.getTensorForAddress(chunk.address) && (
                        <>Tensor {operationDetails.getTensorForAddress(chunk.address)?.tensor_id}</>
                    )}
                    {chunk.empty && 'Empty space'}
                </div>
            </div>
        </div>
    );
};
