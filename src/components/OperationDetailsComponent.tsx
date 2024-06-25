import React, { useState } from 'react';
import { PlotMouseEvent } from 'plotly.js';
import { Switch } from '@blueprintjs/core';
import { getBufferColor } from '../functions/colorGenerator.ts';
import { FragmentationEntry, TensorData } from '../model/APIData.ts';
import L1MemoryRenderer from './L1MemoryRenderer.tsx';
import { getMemoryData } from '../model/ChartUtils.ts';
import LoadingSpinner from './LoadingSpinner.tsx';
import { useOperationDetails, usePreviousOperationDetails } from '../hooks/useAPI.tsx';

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

    const { chartData, memory, fragmentation } = getMemoryData(operationDetails);
    const { chartData: previousChartData, memory: previousMemory } = getMemoryData(previousOperationDetails);

    const memoryReport: FragmentationEntry[] = [...memory, ...fragmentation].sort((a, b) => a.address - b.address);
    const memorySize = operationDetails?.l1_sizes[0] || 0; // TODO: memorysize will need to be calculated for the multichip scenario

    const minPlotRangeStart =
        Math.min(memory[0]?.address || memorySize, previousMemory[0]?.address || memorySize) *
        MINIMAL_MEMORY_RANGE_OFFSET;

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
        <>
            <h2>{operation && `${operation?.id} ${operation.name}`}</h2>
            <Switch
                label={zoomedinView ? 'Full buffer report' : 'Zoom buffer report'}
                checked={zoomedinView}
                onChange={() => setZoomedinView(!zoomedinView)}
            />
            <L1MemoryRenderer
                minRangeStart={minPlotRangeStart}
                chartData={previousChartData}
                zoomedinView={zoomedinView}
                memorySize={memorySize}
            />
            <L1MemoryRenderer
                minRangeStart={minPlotRangeStart}
                chartData={chartData}
                zoomedinView={zoomedinView}
                memorySize={memorySize}
                onBufferClick={onBufferClick}
            />
            <hr />
            {/* ugly inline css below will be going away at the design PR */}
            {/* the below needs a lot of redesigning. */}
            <h3>Legend</h3>
            {memoryReport.map((chunk) => (
                // this likely needs to be a grid of sort to right alight address and size and vertically align coluns
                <div
                    key={chunk.address}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px' }}
                >
                    <div
                        style={{
                            width: '20px',
                            height: '20px',
                            backgroundColor: chunk.empty ? '#fff' : getBufferColor(chunk.address),
                            display: 'inline-block',
                        }}
                    />
                    <span>
                        {chunk.address} - {formatSize(chunk.size)}{' '}
                        {getTensorForAddress(chunk.address) &&
                            `Tensor ${getTensorForAddress(chunk.address)?.tensor_id}`}
                        {chunk.empty && 'Empty'}
                    </span>
                </div>
            ))}
            <hr />

            <>
                {/* op 1422 example: some tensors dont write in L1 and appear white, we need to come up with treatment. */}
                <h3>Inputs</h3>
                {inputs.map((tensor) => (
                    <div key={tensor.tensor_id}>
                        <div
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                color: '#fff',
                            }}
                        >
                            <h4>Tensor ID: {tensor.tensor_id}</h4>
                            <div
                                style={{
                                    width: '20px',
                                    height: '20px',
                                    backgroundColor: getBufferColor(tensor.address),
                                    display: 'inline-block',
                                }}
                            />
                            <span>{tensor.address}</span>
                        </div>

                        <div style={{ paddingLeft: '30px' }}>
                            <p>Shape: {tensor.shape}</p>
                            <p>Dtype: {tensor.dtype}</p>
                            <p>Layout: {tensor.layout}</p>
                        </div>
                    </div>
                ))}
                <h3>Outputs</h3>
                {outputs.map((tensor) => (
                    <div key={tensor.tensor_id}>
                        <div
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                color: '#fff',
                            }}
                        >
                            <h4>Tensor ID: {tensor.tensor_id}</h4>
                            <div
                                style={{
                                    width: '20px',
                                    height: '20px',
                                    backgroundColor: getBufferColor(tensor.address),
                                    display: 'inline-block',
                                }}
                            />
                            <span>{tensor.address}</span>
                        </div>

                        <div style={{ paddingLeft: '30px' }}>
                            <p>Shape: {tensor.shape}</p>
                            <p>Dtype: {tensor.dtype}</p>
                            <p>Layout: {tensor.layout}</p>
                        </div>
                    </div>
                ))}
            </>

            <hr />
        </>
    );
};
export default OperationDetailsComponent;
