import React, { useState } from 'react';
import { Button, Card, Overlay2 } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { PlotData } from 'plotly.js';
import classNames from 'classnames';
import { BufferType } from '../../model/BufferType';
import { useBufferPages, useDevices } from '../../hooks/useAPI';
import '../../scss/components/TensorVisualizationComponent.scss';
import LoadingSpinner from '../LoadingSpinner';
import { BufferPage } from '../../model/APIData';
import SVGBufferRenderer from './SVGBufferRenderer';
import { HistoricalTensor } from '../../model/Graph';
import { getTensorColor } from '../../functions/colorGenerator';
import getChartData, { pageDataToChunkArray } from '../../functions/getChartData';
import { L1RenderConfiguration } from '../../definitions/PlotConfigurations';
import MemoryPlotRenderer from '../operation-details/MemoryPlotRenderer';

export interface TensorVisualisationComponentProps {
    title: string;
    operationId: number;
    address?: number | string | undefined;
    bufferType?: BufferType;
    isOpen: boolean;
    onClose: () => void;
    tensorByAddress?: Map<number, HistoricalTensor>;
    tensorId?: number;
    zoomRange: [number, number];
}

/**
 * @description Component for visualising buffer pagination data on tensix grid
 * @param title popup title
 * @param operationId
 * @param address buffer address or comma separated list of addresses
 * @param bufferType buffer type (always L1 as there is no other page data)
 * @param isOpen
 * @param onClose close callback
 * @param tensorByAddress optional historical lookup map
 * @param tensorId optionally used in the absence of tensorByAddress
 * @param zoomRange range of memory to display
 * @constructor
 */
const TensorVisualisationComponent: React.FC<TensorVisualisationComponentProps> = ({
    title,
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

    const [selectedTensix, setSelectedTensix] = useState<number | null>(null);
    const [chartData, setChartData] = useState<Partial<PlotData>[]>([]);
    if (!data || !devices) {
        return (
            <span className='tensor-visualisation-loader'>
                <LoadingSpinner />
            </span>
        );
    }

    const width = devices[0].num_x_cores;
    const height = devices[0].num_y_cores;

    const memStart = zoomRange[0];
    const memSize = zoomRange[1];
    const tensixSize = 120;
    const tensixHeight = tensixSize / 3;

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
                <div className='header'>
                    <h3 className='title'>
                        {title}
                        <Button
                            icon={IconNames.CROSS}
                            minimal
                            small
                            onClick={onClose}
                        />
                    </h3>
                </div>
                <div className='chip'>
                    <div
                        className='tensix-grid empty'
                        style={{
                            gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${tensixHeight}px)`,
                        }}
                    >
                        {Array.from({ length: width * height }).map((_, index) => (
                            <div
                                key={index}
                                className='tensix empty-tensix'
                                style={{
                                    width: `${tensixSize}px`,
                                    height: `${tensixHeight}px`,
                                    gridColumn: (index % width) + 1,
                                    gridRow: Math.floor(index / width) + 1,
                                }}
                            />
                        ))}
                    </div>
                    <div
                        className='tensix-grid'
                        style={{
                            gridTemplateColumns: `repeat(${width || 0}, ${tensixSize}px)`,
                            gridTemplateRows: `repeat(${height || 0}, ${tensixHeight}px)`,
                        }}
                    >
                        {coordsByBankId.map((coords, index) => (
                            <button
                                type='button'
                                key={index}
                                className={classNames('tensix', { active: selectedTensix === index })}
                                style={{
                                    width: `${tensixSize}px`,
                                    height: `${tensixHeight}px`,
                                    gridColumn: coords.x + 1,
                                    gridRow: coords.y + 1,
                                }}
                                onClick={() => {
                                    setSelectedTensix(index);
                                    setChartData(
                                        getChartData(
                                            pageDataToChunkArray(buffersByBankId[index]),
                                            (id) => tensorByAddress?.get(id) || null,
                                        ),
                                    );
                                }}
                            >
                                <SVGBufferRenderer
                                    width={tensixSize - 2}
                                    height={tensixHeight}
                                    data={buffersByBankId[index]}
                                    memorySize={memSize}
                                    memoryStart={memStart}
                                />
                            </button>
                        ))}
                    </div>
                </div>
                {selectedTensix !== null && (
                    <div className='tensix-details'>
                        <div className='tensix-details-header'>
                            <Button
                                icon={IconNames.CROSS}
                                minimal
                                small
                                onClick={() => {
                                    setSelectedTensix(null);
                                }}
                            />
                        </div>
                        <div className='tensix-details-content'>
                            <MemoryPlotRenderer
                                title={`Detailed L1 Report for ${coordsByBankId[selectedTensix].y}-${
                                    coordsByBankId[selectedTensix].x
                                }`}
                                className='detailed-l1-memory-renderer l1-memory-renderer'
                                isZoomedIn
                                plotZoomRange={[memStart, memSize]}
                                chartDataList={[chartData]}
                                memorySize={memSize}
                                onBufferClick={() => {}}
                                configuration={{
                                    ...L1RenderConfiguration,
                                    title: `L1 address space for ${coordsByBankId[selectedTensix].y}-${coordsByBankId[selectedTensix].x}`,
                                }}
                            />
                        </div>
                    </div>
                )}
            </Card>
        </Overlay2>
    );
};

export default TensorVisualisationComponent;
