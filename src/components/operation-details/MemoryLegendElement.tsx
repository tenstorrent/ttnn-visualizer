import React from 'react';
import classNames from 'classnames';
import { Icon, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { FragmentationEntry } from '../../model/APIData';
import { OperationDetails } from '../../model/OperationDetails';
import { getBufferColor } from '../../functions/colorGenerator';
import { formatSize, prettyPrintAddress, toHex } from '../../functions/math';

export const MemoryLegendElement: React.FC<{
    chunk: FragmentationEntry;
    memSize: number;
    selectedTensorAddress: number | null;
    operationDetails: OperationDetails;
    onLegendClick: (selectedTensorAddress: number) => void;
}> = ({
    // no wrap eslint
    chunk,
    memSize,
    selectedTensorAddress,
    operationDetails,
    onLegendClick,
}) => {
    const Component = !chunk.empty ? 'button' : 'div';
    const emptyChunkLabel = (
        <>
            Empty space{' '}
            {chunk.largestEmpty && (
                <Tooltip content='Largest empty memory space'>
                    <Icon icon={IconNames.TICK} />
                </Tooltip>
            )}
        </>
    );
    return (
        <Component
            key={chunk.address}
            className={classNames('legend-item', {
                button: !chunk.empty,
                dimmed: selectedTensorAddress !== null && selectedTensorAddress !== chunk.address,
            })}
            // eslint-disable-next-line react/jsx-props-no-spreading
            {...(!chunk.empty ? { type: 'button', onClick: () => onLegendClick(chunk.address) } : {})}
        >
            <div
                className={classNames('memory-color-block', {
                    empty: chunk.empty,
                })}
                style={{
                    ...(chunk.empty ? {} : { backgroundColor: getBufferColor(chunk.address) }),
                }}
            />
            <div className='legend-details'>
                <div className='format-numbers monospace'>{prettyPrintAddress(chunk.address, memSize)}</div>
                <div className='format-numbers monospace keep-left'>({toHex(chunk.address)})</div>
                <div className='format-numbers monospace'>{formatSize(chunk.size)} </div>
                <div>
                    {!chunk.empty && operationDetails.getTensorForAddress(chunk.address) && (
                        <>Tensor {operationDetails.getTensorForAddress(chunk.address)?.id}</>
                    )}
                    {chunk.empty && emptyChunkLabel}
                </div>
            </div>
        </Component>
    );
};
