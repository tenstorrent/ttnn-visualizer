import React, { useState } from 'react';
import { PlotMouseEvent } from 'plotly.js';
import { Switch } from '@blueprintjs/core';
import classNames from 'classnames';
import { getBufferColor } from '../../functions/colorGenerator';
import { FragmentationEntry, TensorData } from '../../model/APIData';
import L1MemoryRenderer from './L1MemoryRenderer';
import { getMemoryData } from '../../model/ChartUtils';
import LoadingSpinner from '../LoadingSpinner';
import { useOperationDetails, usePreviousOperationDetails } from '../../hooks/useAPI';
import 'styles/components/OperationDetailsComponent.scss';
import { formatSize, prettyPrintAddress, toHex } from '../../functions/math';
import TensorDetailsComponent from './TensorDetailsComponent';
import StackTrace from './StackTrace';

interface OperationDetailsProps {
    operationId: number;
    isFullStackTrace: boolean;
    toggleStackTraceHandler: (condition: boolean) => void;
}

const MINIMAL_MEMORY_RANGE_OFFSET = 0.98;

const OperationDetailsComponent: React.FC<OperationDetailsProps> = ({
    operationId,
    isFullStackTrace,
    toggleStackTraceHandler,
}) => {
    const [zoomedInView, setZoomedInView] = useState(false);

    const { operationDetails: details } = useOperationDetails(operationId);

    const { data: operationDetails, isLoading } = details;
    const { data: previousOperationDetails, isLoading: isPrevLoading } =
        usePreviousOperationDetails(operationId).operationDetails;

    const [selectedTensorAddress, setSelectedTensorAddress] = useState<number | null>(null);

    if (isLoading || isPrevLoading || !operationDetails || !previousOperationDetails) {
        return (
            <div className='operation-details-loader'>
                <LoadingSpinner />
            </div>
        );
    }

    const inputs = operationDetails?.input_tensors;
    const outputs = operationDetails?.output_tensors;

    const tensorList: TensorData[] =
        [
            [
                ...(inputs?.map((input) => {
                    return { ...input, io: 'input' } as TensorData;
                }) || []),
            ],
            [
                ...(outputs?.map((output) => {
                    return { ...output, io: 'output' } as TensorData;
                }) || []),
            ],
        ].flat() || [];

    const { chartData, memory, fragmentation } = getMemoryData(operationDetails);
    const { chartData: previousChartData, memory: previousMemory } = getMemoryData(previousOperationDetails);

    const memoryReport: FragmentationEntry[] = [...memory, ...fragmentation].sort((a, b) => a.address - b.address);
    const memorySize = operationDetails?.l1_sizes[0] || 0; // TODO: memorysize will need to be read from the appropriate device even though its likely going to be the same for the multichip scenario

    let plotZoomRangeStart =
        Math.min(memory[0]?.address || memorySize, previousMemory[0]?.address || memorySize) *
        MINIMAL_MEMORY_RANGE_OFFSET;

    let plotZoomRangeEnd =
        Math.max(
            memory.length > 0 ? memory[memory.length - 1].address + memory[memory.length - 1].size : 0,
            previousMemory.length > 0
                ? previousMemory[previousMemory.length - 1].address + previousMemory[previousMemory.length - 1].size
                : 0,
        ) *
        (1 / MINIMAL_MEMORY_RANGE_OFFSET);

    if (plotZoomRangeEnd < plotZoomRangeStart) {
        plotZoomRangeStart = 0;
        plotZoomRangeEnd = memorySize;
    }

    const onBufferClick = (event: Readonly<PlotMouseEvent>): void => {
        const { address } = memory[event.points[0].curveNumber];
        setSelectedTensorAddress(address);
    };
    const onClickOutside = () => {
        setSelectedTensorAddress(null);
    };

    const getTensorForAddress = (address: number): TensorData | null => {
        return tensorList.find((tensor) => tensor.address === address) || null;
    };

    return (
        <div className='operation-details-component'>
            <StackTrace
                stackTrace={operationDetails.stack_traces[0].stack_trace}
                isFullStackTrace={isFullStackTrace}
                toggleStackTraceHandler={toggleStackTraceHandler}
            />

            <Switch
                label={zoomedInView ? 'Full buffer report' : 'Zoom buffer report'}
                checked={zoomedInView}
                onChange={() => setZoomedInView(!zoomedInView)}
            />

            <L1MemoryRenderer
                title='Previous Summarized L1 Report'
                className={classNames('l1-memory-renderer', { 'empty-plot': previousChartData.length === 0 })}
                plotZoomRangeStart={plotZoomRangeStart}
                plotZoomRangeEnd={plotZoomRangeEnd}
                chartData={previousChartData}
                isZoomedIn={zoomedInView}
                memorySize={memorySize}
            />

            <L1MemoryRenderer
                title='Current Summarized L1 Report'
                className={classNames('l1-memory-renderer', { 'empty-plot': chartData.length === 0 })}
                plotZoomRangeStart={plotZoomRangeStart}
                plotZoomRangeEnd={plotZoomRangeEnd}
                chartData={chartData}
                isZoomedIn={zoomedInView}
                memorySize={memorySize}
                onBufferClick={onBufferClick}
                onClickOutside={onClickOutside}
            />
            <aside className={classNames('plot-instructions', { hidden: chartData.length === 0 })}>
                Click on a buffer to focus
            </aside>

            <aside className={classNames('plot-instructions-floating', { hidden: selectedTensorAddress === null })}>
                Buffer focused, click anywhere to reset
            </aside>

            <div className='legend'>
                {memoryReport.map((chunk) => (
                    <div
                        key={chunk.address}
                        className={classNames('legend-item', {
                            dimmed: selectedTensorAddress !== null && selectedTensorAddress !== chunk.address,
                        })}
                    >
                        <div
                            className={classNames('memory-color-block', { empty: chunk.empty === true })}
                            style={{
                                backgroundColor: chunk.empty ? '#fff' : getBufferColor(chunk.address),
                            }}
                        />
                        <div className='legend-details'>
                            <div className='format-numbers'>{prettyPrintAddress(chunk.address, memorySize)}</div>
                            <div className='format-numbers keep-left'>({toHex(chunk.address)})</div>
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

            <div className='tensor-list'>
                <div className='inputs'>
                    <h3>Inputs</h3>
                    {inputs.map((tensor) => (
                        <TensorDetailsComponent
                            tensor={tensor}
                            key={tensor.tensor_id}
                            selectedAddress={selectedTensorAddress}
                        />
                    ))}
                </div>
                <div className='outputs'>
                    <h3>Outputs</h3>
                    {outputs.map((tensor) => (
                        <TensorDetailsComponent
                            tensor={tensor}
                            key={tensor.tensor_id}
                            selectedAddress={selectedTensorAddress}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};
export default OperationDetailsComponent;
