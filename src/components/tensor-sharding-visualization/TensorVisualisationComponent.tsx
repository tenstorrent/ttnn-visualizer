import React from 'react';
import { Card, Overlay2 } from '@blueprintjs/core';
import { BufferType } from '../../model/BufferType';
import { useBufferPages, useDevices } from '../../hooks/useAPI';
import '../../scss/components/TensorVisualizationComponent.scss';
import LoadingSpinner from '../LoadingSpinner';
import { BufferPage } from '../../model/APIData';
import SVGBufferRenderer from './SVGBufferRenderer';
import { HistoricalTensor } from '../../model/Graph';
import { getTensorColor } from '../../functions/colorGenerator';

export interface TensorVisualisationComponentProps {
    operationId: number;
    address?: number | string | undefined;
    bufferType?: BufferType;
    isOpen: boolean;
    onClose: () => void;
    tensorByAddress?: Map<number, HistoricalTensor>;
    tensorId?: number;
    zoomRange: [number, number];
}

const TensorVisualisationComponent: React.FC<TensorVisualisationComponentProps> = ({
    operationId,
    address,
    bufferType,
    isOpen,
    onClose,
    tensorByAddress,
    zoomRange,
    tensorId,
}) => {
    const { data } = useBufferPages(operationId, address, bufferType);
    const { data: devices } = useDevices();

    if (!data || !devices) {
        return <LoadingSpinner />;
    }

    const width = devices[0].num_x_cores;
    const height = devices[0].num_y_cores;

    const memStart = zoomRange[0];
    const memSize = zoomRange[1];
    const tensixSize = 80;

    const buffersByBankId: BufferPage[][] = [];
    const coordsByBankId: { x: number; y: number }[] = [];

    data.forEach((page: BufferPage) => {
        if (!buffersByBankId[page.bank_id]) {
            buffersByBankId[page.bank_id] = [];
        }

        if (tensorByAddress) {
            const tensor = tensorByAddress?.get(page.address);
            page.tensor_id = tensor?.id;
            page.color = getTensorColor(tensor?.id);
        } else {
            page.color = getTensorColor(tensorId);
        }
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
                            <SVGBufferRenderer
                                width={tensixSize}
                                height={tensixSize}
                                data={buffersByBankId[index]}
                                memorySize={memSize}
                                memoryStart={memStart}
                            />
                            {/* {buffersByBankId[index].map((page) => ( */}
                            {/*    <div */}
                            {/*        key={page.id} */}
                            {/*        style={{ */}
                            {/*            width: '100%', */}
                            {/*            height: `${(tensixSize / memSize) * page.page_size * 10}px`, */}
                            {/*            backgroundColor: 'red', */}
                            {/*        }} */}
                            {/*    /> */}
                            {/* ))} */}
                        </div>
                    ))}
                </div>
            </Card>
        </Overlay2>
    );
};

export default TensorVisualisationComponent;
