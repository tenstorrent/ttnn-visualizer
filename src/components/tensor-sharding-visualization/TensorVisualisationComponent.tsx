import React from 'react';
import { Card, Overlay2 } from '@blueprintjs/core';
import { BufferType } from '../../model/BufferType';
import { useBufferPages, useDevices } from '../../hooks/useAPI';
import '../../scss/components/TensorVisualizationComponent.scss';
import LoadingSpinner from '../LoadingSpinner';
import { BufferPage } from '../../model/APIData';

export interface TensorVisualisationComponentProps {
    operationId: number;
    address?: number | undefined;
    bufferType?: BufferType;
    isOpen: boolean;
    onClose: () => void;
}

const TensorVisualisationComponent: React.FC<TensorVisualisationComponentProps> = ({
    operationId,
    address,
    bufferType,
    isOpen,
    onClose,
}) => {
    const { data } = useBufferPages(operationId, address, bufferType);
    const { data: devices } = useDevices();

    if (!data || !devices) {
        return <LoadingSpinner />;
    }

    const width = devices[0].num_x_cores;
    const height = devices[0].num_y_cores;

    const memSize = devices[0].l1_bank_size;
    const tensixSize = 80;

    const buffersByBankId: BufferPage[][] = [];
    const coordsByBankId: { x: number; y: number }[] = [];

    data.forEach((page: BufferPage) => {
        if (!buffersByBankId[page.bank_id]) {
            buffersByBankId[page.bank_id] = [];
        }
        // page.tensor_id =
        buffersByBankId[page.bank_id].push(page);
        coordsByBankId[page.bank_id] = { x: page.core_x, y: page.core_y };
    });
    return (
        <Overlay2
            isOpen={isOpen}
            enforceFocus
            hasBackdrop
            usePortal
            canEscapeKeyClose
            transitionDuration={0}
            onClose={onClose}
            canOutsideClickClose
            portalClassName='tensor-visualisation-overlay'
        >
            <Card className='tensor-visualisation'>
                <div
                    className='chip'
                    style={{
                        display: 'grid',
                        gap: '5px',
                        gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                        gridTemplateRows: `repeat(${height || 0}, ${tensixSize}px)`,
                    }}
                >
                    {coordsByBankId.map((coords, index) => (
                        <div
                            // eslint-disable-next-line react/no-array-index-key
                            key={index}
                            className='tensix'
                            style={{
                                width: `${tensixSize}px`,
                                height: `${tensixSize}px`,
                                gridColumn: coords.x + 1,
                                gridRow: coords.y + 1,
                                display: 'flex',
                                flexDirection: 'column',
                                // gap: '1px',
                            }}
                        >
                            {buffersByBankId[index].map((page) => (
                                <div
                                    key={page.id}
                                    style={{
                                        width: '100%',
                                        height: `${(tensixSize / memSize) * page.page_size * 10}px`,
                                        backgroundColor: 'red',
                                    }}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </Card>
        </Overlay2>
    );
};

export default TensorVisualisationComponent;
