import React, { useState } from 'react';
import { PlotMouseEvent } from 'plotly.js';
import { Switch } from '@blueprintjs/core';
import { getBufferColor } from '../functions/colorGenerator.ts';
import { FragmentationEntry, TensorData } from '../model/APIData.ts';
import L1MemoryRenderer from './L1MemoryRenderer.tsx';
import { getMemoryData } from '../model/ChartUtils.ts';
import LoadingSpinner from './LoadingSpinner.tsx';
import { useOperationDetails, usePreviousOperationDetails } from '../hooks/useAPI.tsx';
import 'styles/components/OperationDetailsComponent.scss';
import toHex from '../functions/math.ts';

interface OperationDetailsProps {
    operationId: number;
}

const MINIMAL_MEMORY_RANGE_OFFSET = 0.98;

const OperationDetailsComponent: React.FC<OperationDetailsProps> = ({ operationId }) => {
    const [zoomedinView, setZoomedinView] = useState(false);

    const { operation, operationDetails: details } = useOperationDetails(operationId);

    const { data: operationDetails, isLoading } = details;
    const { data: previousOperationDetails, isLoading: isPrevLoading } =
        usePreviousOperationDetails(operationId).operationDetails;

    if (isLoading || isPrevLoading || !operationDetails || !previousOperationDetails) {
        return (
            <div>
                <LoadingSpinner />
            </div>
        );
    }

    const formatSize = (number: number): string => {
        return new Intl.NumberFormat('en-US').format(number);
    };

    const tensorList: TensorData[] =
        [
            [
                ...(operationDetails?.input_tensors?.map((input) => {
                    return { ...input, io: 'input' } as TensorData;
                }) || []),
            ],
            [
                ...(operationDetails?.output_tensors?.map((output) => {
                    return { ...output, io: 'output' } as TensorData;
                }) || []),
            ],
        ].flat() || [];

    const inputs = operationDetails?.input_tensors;
    const outputs = operationDetails?.output_tensors;

    const { chartData, memory, fragmentation } = getMemoryData(operationDetails, zoomedinView);
    const { chartData: previousChartData, memory: previousMemory } = getMemoryData(
        previousOperationDetails,
        zoomedinView,
    );

    const memoryReport: FragmentationEntry[] = [...memory, ...fragmentation].sort((a, b) => a.address - b.address);
    const memorySize = operationDetails?.l1_sizes[0] || 0; // TODO: memorysize will need to be calculated for the multichip scenario

    const plotZoomRangeStart =
        Math.min(memory[0]?.address || memorySize, previousMemory[0]?.address || memorySize) *
        MINIMAL_MEMORY_RANGE_OFFSET;

    const plotZoomRangeEnd =
        Math.max(
            memory.length > 0 ? memory[memory.length - 1].address + memory[memory.length - 1].size : 0,
            previousMemory.length > 0
                ? previousMemory[previousMemory.length - 1].address + previousMemory[previousMemory.length - 1].size
                : 0,
        ) *
        (1 / MINIMAL_MEMORY_RANGE_OFFSET);

    const onBufferClick = (event: Readonly<PlotMouseEvent>): void => {
        // TODO: stub method for clicking on the buffer
        const { address } = memory[event.points[0].curveNumber];
        // eslint-disable-next-line no-console
        console.log(address);
    };

    const getTensorForAddress = (address: number): TensorData | null => {
        return tensorList.find((tensor) => tensor.address === address) || null;
    };

    return (
        <div className='operation-details-component'>
            <h2 className='title'>{operation && `${operation?.id} ${operation.name}`}</h2>
            <Switch
                label={zoomedinView ? 'Full buffer report' : 'Zoom buffer report'}
                checked={zoomedinView}
                onChange={() => setZoomedinView(!zoomedinView)}
            />
            {previousChartData.length !== 0 && (
                <L1MemoryRenderer
                    title='Previous Summarized L1 Report'
                    plotZoomRangeStart={plotZoomRangeStart}
                    plotZoomRangeEnd={plotZoomRangeEnd}
                    chartData={previousChartData}
                    zoomedinView={zoomedinView}
                    memorySize={memorySize}
                />
            )}
            {chartData.length !== 0 && (
                <L1MemoryRenderer
                    title='Current Summarized L1 Report'
                    plotZoomRangeStart={plotZoomRangeStart}
                    plotZoomRangeEnd={plotZoomRangeEnd}
                    chartData={chartData}
                    zoomedinView={zoomedinView}
                    memorySize={memorySize}
                    onBufferClick={onBufferClick}
                />
            )}

            {/* ugly inline css below will be going away at the design PR */}
            {/* the below needs a lot of redesigning. */}

            <div className='legend'>
                {memoryReport.map((chunk) => (
                    <div className='legend-item' key={chunk.address}>
                        <div
                            className={`memory-color-block ${chunk.empty ? 'empty' : ''}`}
                            style={{
                                backgroundColor: chunk.empty ? '#fff' : getBufferColor(chunk.address),
                            }}
                        />
                        <div className='legend-details'>
                            <div className='format-numbers'>
                                {chunk.address} ({toHex(chunk.address)})
                            </div>
                            <div className='format-numbers'>{formatSize(chunk.size)} </div>
                            <div>
                                {getTensorForAddress(chunk.address) && (
                                    <>Tensor {getTensorForAddress(chunk.address)?.tensor_id}</>
                                )}
                                {chunk.empty && 'Empty space'}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <hr />

            {/* op 1422 example: some tensors dont write in L1 and appear white, we need to come up with treatment. */}
            <div className='tensor-list'>
                <div className='inputs'>
                    <h3>Inputs</h3>
                    {inputs.map((tensor) => (
                        <div className='tensor-item' key={tensor.tensor_id}>
                            <div className='tensor-name'>
                                <div
                                    className={`memory-color-block ${tensor.address === null ? 'empty-tensor' : ''}`}
                                    style={{
                                        backgroundColor: getBufferColor(tensor.address),
                                    }}
                                />
                                <h4>Tensor ID: {tensor.tensor_id}</h4>

                                <span>{tensor.address}</span>
                            </div>

                            <div className='tensor-meta'>
                                <p>Shape: {tensor.shape}</p>
                                <p>Dtype: {tensor.dtype}</p>
                                <p>Layout: {tensor.layout}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <div className='outputs'>
                    <h3>Outputs</h3>
                    {outputs.map((tensor) => (
                        <div className='tensor-item' key={tensor.tensor_id}>
                            <div className='tensor-name'>
                                <div
                                    className='memory-color-block'
                                    style={{
                                        backgroundColor: getBufferColor(tensor.address),
                                    }}
                                />
                                <h4>Tensor ID: {tensor.tensor_id}</h4>

                                <span>{tensor.address}</span>
                            </div>

                            <div className='tensor-meta'>
                                <p>Shape: {tensor.shape}</p>
                                <p>Dtype: {tensor.dtype}</p>
                                <p>Layout: {tensor.layout}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
export default OperationDetailsComponent;
