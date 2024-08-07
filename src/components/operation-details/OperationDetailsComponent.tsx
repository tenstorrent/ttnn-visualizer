import React, { useRef, useState } from 'react';
import { PlotMouseEvent } from 'plotly.js';
import { Icon, Switch } from '@blueprintjs/core';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { IconNames } from '@blueprintjs/icons';
import { getBufferColor } from '../../functions/colorGenerator';
import { FragmentationEntry } from '../../model/APIData';
import MemoryPlotRenderer from './MemoryPlotRenderer';
import { useOperationDetails, useOperationsList, usePreviousOperationDetails } from '../../hooks/useAPI';
import 'styles/components/OperationDetailsComponent.scss';
import { formatSize, isEqual, prettyPrintAddress, toHex } from '../../functions/math';
import TensorDetailsComponent from './TensorDetailsComponent';
import StackTrace from './StackTrace';
import OperationDetailsNavigation from '../OperationDetailsNavigation';
import { OperationDetails } from '../../model/OperationDetails';
import ROUTES from '../../definitions/routes';
import { BufferType } from '../../model/BufferType';
import { DRAM_MEMORY_SIZE } from '../../definitions/DRAMMemorySize';
import {
    CONDENSED_PLOT_CHUNK_COLOR,
    DRAMRenderConfiguration,
    L1RenderConfiguration,
} from '../../definitions/PlotConfigurations';

interface OperationDetailsProps {
    operationId: number;
}

const MINIMAL_MEMORY_RANGE_OFFSET = 0.98;
const MINIMAL_DRAM_MEMORY_RANGE_OFFSET = 0.9998;

const OperationDetailsComponent: React.FC<OperationDetailsProps> = ({ operationId }) => {
    const { data: operations } = useOperationsList();
    const [zoomedInView, setZoomedInView] = useState(false);
    const [isFullStackTrace, setIsFullStackTrace] = useState(false);

    const {
        operationDetails: { data: operationDetails, isLoading },
    } = useOperationDetails(operationId);

    const { data: previousOperationDetails, isLoading: isPrevLoading } =
        usePreviousOperationDetails(operationId).operationDetails;

    const [selectedTensorAddress, setSelectedTensorAddress] = useState<number | null>(null);
    const [selectedTensor, setSelectedTensor] = useState<number | null>(null);

    const onClickOutside = () => {
        setSelectedTensorAddress(null);
        setSelectedTensor(null);
    };

    const navRef = useRef<HTMLDivElement>(null);

    if (isLoading || isPrevLoading || !operationDetails || !previousOperationDetails) {
        return (
            <OperationDetailsNavigation
                operationId={operationId}
                isFullStackTrace={isFullStackTrace}
                isLoading={isLoading}
            />
        );
    }

    const details: OperationDetails | null = new OperationDetails(operationDetails);
    details.updateOperationNames(operations);

    const previousDetails: OperationDetails | null = new OperationDetails(previousOperationDetails);
    previousDetails.updateOperationNames(operations);

    const l1Small = details.memoryData(BufferType.L1_SMALL);

    const { chartData, memory, fragmentation } = details.memoryData();
    const { chartData: previousChartData, memory: previousMemory } = previousDetails.memoryData();

    const { chartData: dramData, memory: dramMemory } = details.memoryData(BufferType.DRAM);
    const { chartData: previosDramData, memory: previousDramMemory } = previousDetails.memoryData(BufferType.DRAM);

    const memoryReport: FragmentationEntry[] = [...memory, ...fragmentation].sort((a, b) => a.address - b.address);
    const dramMemoryReport: FragmentationEntry[] = [...dramMemory].sort((a, b) => a.address - b.address);

    if (l1Small.condensedChart[0] !== undefined) {
        l1Small.condensedChart[0].marker!.color = CONDENSED_PLOT_CHUNK_COLOR;
        l1Small.condensedChart[0].hovertemplate = `
<span style="color:${CONDENSED_PLOT_CHUNK_COLOR};font-size:20px;">&#9632;</span>
<br />
<span>L1 Small Condensed view</span>
<extra></extra>`;
    }

    const { memorySizeL1 } = details;

    let plotZoomRangeStart =
        Math.min(memory[0]?.address || memorySizeL1, previousMemory[0]?.address || memorySizeL1) *
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
        plotZoomRangeEnd = memorySizeL1;
    }

    let dramPlotZoomRangeStart =
        Math.min(dramMemory[0]?.address || DRAM_MEMORY_SIZE, previousDramMemory[0]?.address || DRAM_MEMORY_SIZE) *
        MINIMAL_DRAM_MEMORY_RANGE_OFFSET;

    let dramPlotZoomRangeEnd =
        Math.max(
            dramMemory.length > 0
                ? dramMemory[dramMemory.length - 1].address + dramMemory[dramMemory.length - 1].size
                : 0,
            previousDramMemory.length > 0
                ? previousDramMemory[previousDramMemory.length - 1].address +
                      previousDramMemory[previousDramMemory.length - 1].size
                : 0,
        ) *
        (1 / MINIMAL_DRAM_MEMORY_RANGE_OFFSET);

    if (dramPlotZoomRangeEnd < dramPlotZoomRangeStart) {
        dramPlotZoomRangeStart = 0;
        dramPlotZoomRangeEnd = DRAM_MEMORY_SIZE;
    }

    const selectTensorByAddress = (address: number): void => {
        setSelectedTensorAddress(address);
        setSelectedTensor(details.getTensorForAddress(address)?.tensor_id || null);
    };

    const onDramDeltaClick = (event: Readonly<PlotMouseEvent>): void => {
        const index = event.points[0].curveNumber;
        const { address } = dramDeltaObject.memory[index];
        selectTensorByAddress(address);
    };

    const onDramBufferClick = (event: Readonly<PlotMouseEvent>): void => {
        const index = event.points[0].curveNumber;
        const { address } = dramMemory[index];
        selectTensorByAddress(address);
    };

    const onBufferClick = (event: Readonly<PlotMouseEvent>): void => {
        const index = event.points[0].curveNumber;
        // this is a hacky way to determine this
        if (index >= memory.length) {
            console.log('Are we clicking on L1 small?');
        } else {
            const { address } = memory[index];
            selectTensorByAddress(address);
        }
    };

    const onTensorClick = (id: number): void => {
        const address = details.tensorList.find((t) => t.tensor_id === id)?.address || null;
        setSelectedTensorAddress(address);
        setSelectedTensor(id);
    };

    // TODO: keeping this as a reminder. this wont work properly while we pick tensor by address only, an only for a specific operation
    // const onPreviousBufferClick = (event: Readonly<PlotMouseEvent>): void => {
    //     const { address } = previousMemory[event.points[0].curveNumber];
    //     setSelectedTensorAddress(address);
    // };

    const dramHasntChanged = isEqual(dramMemory, previousDramMemory);

    const dramDelta = dramMemoryReport.filter(
        (chunk) => !chunk.empty && !previousDramMemory.find((c) => c.address === chunk.address),
    );
    const reverseDramDelta = previousDramMemory.filter(
        (chunk) => !dramMemoryReport.find((c) => c.address === chunk.address),
    );

    const dramDeltaObject = details.getMemoryDelta(dramDelta, reverseDramDelta);

    const dramTensorsOnly = dramMemoryReport.filter(
        (chunk) => !chunk.empty && details.getTensorForAddress(chunk.address),
    );

    return (
        <>
            <OperationDetailsNavigation
                operationId={operationId}
                isFullStackTrace={isFullStackTrace}
                isLoading={isLoading}
            />

            <div className='operation-details-component'>
                {!isLoading && Number.isSafeInteger(operationDetails?.operation_id) ? (
                    <>
                        {details.stack_trace && (
                            <StackTrace
                                stackTrace={details.stack_trace}
                                isFullStackTrace={isFullStackTrace}
                                toggleStackTraceHandler={setIsFullStackTrace}
                            />
                        )}

                        <Switch
                            label={zoomedInView ? 'Full buffer reports' : 'Zoom buffer reports'}
                            checked={zoomedInView}
                            onChange={() => setZoomedInView(!zoomedInView)}
                        />

                        <h3>L1 Memory</h3>
                        <MemoryPlotRenderer
                            title='Previous Summarized L1 Report'
                            className={classNames('l1-memory-renderer', {
                                'empty-plot': previousChartData.length === 0,
                            })}
                            plotZoomRangeStart={plotZoomRangeStart}
                            plotZoomRangeEnd={plotZoomRangeEnd}
                            chartData={previousChartData}
                            isZoomedIn={zoomedInView}
                            memorySize={memorySizeL1}
                            configuration={L1RenderConfiguration}
                        />

                        <MemoryPlotRenderer
                            title='Current Summarized L1 Report'
                            className={classNames('l1-memory-renderer', { 'empty-plot': chartData.length === 0 })}
                            plotZoomRangeStart={plotZoomRangeStart}
                            plotZoomRangeEnd={plotZoomRangeEnd}
                            chartData={chartData.concat(l1Small.condensedChart)}
                            isZoomedIn={zoomedInView}
                            memorySize={memorySizeL1}
                            onBufferClick={onBufferClick}
                            onClickOutside={onClickOutside}
                            additionalReferences={[navRef]}
                            configuration={L1RenderConfiguration}
                        />

                        <aside className={classNames('plot-instructions', { hidden: chartData.length === 0 })}>
                            Click on a buffer to focus
                        </aside>

                        <aside
                            className={classNames('plot-instructions-floating', {
                                hidden: selectedTensorAddress === null,
                            })}
                        >
                            Buffer focused, click anywhere to reset
                        </aside>

                        <h3>DRAM Memory</h3>

                        <MemoryPlotRenderer
                            title={`Previous Summarized DRAM Report ${dramHasntChanged ? ' (No changes)' : ''}  `}
                            className={classNames('dram-memory-renderer', {
                                'empty-plot': previosDramData.length === 0,
                                'identical-plot': dramHasntChanged,
                            })}
                            plotZoomRangeStart={dramPlotZoomRangeStart}
                            plotZoomRangeEnd={dramPlotZoomRangeEnd}
                            chartData={previosDramData}
                            isZoomedIn={zoomedInView}
                            memorySize={DRAM_MEMORY_SIZE}
                            configuration={DRAMRenderConfiguration}
                        />
                        <MemoryPlotRenderer
                            title='Current Summarized DRAM Report'
                            className={classNames('dram-memory-renderer', { 'empty-plot': dramData.length === 0 })}
                            plotZoomRangeStart={dramPlotZoomRangeStart}
                            plotZoomRangeEnd={dramPlotZoomRangeEnd}
                            chartData={dramData}
                            isZoomedIn={zoomedInView}
                            memorySize={DRAM_MEMORY_SIZE}
                            onBufferClick={onDramBufferClick}
                            onClickOutside={onClickOutside}
                            additionalReferences={[navRef]}
                            configuration={DRAMRenderConfiguration}
                        />
                        <MemoryPlotRenderer
                            title='DRAM Delta (difference between current and previous operation)'
                            className={classNames('dram-memory-renderer', {
                                'empty-plot': dramDeltaObject.chartData.length === 0,
                            })}
                            plotZoomRangeStart={dramDeltaObject.min}
                            plotZoomRangeEnd={dramDeltaObject.max}
                            chartData={dramDeltaObject.chartData}
                            isZoomedIn
                            memorySize={DRAM_MEMORY_SIZE}
                            onBufferClick={onDramDeltaClick}
                            onClickOutside={onClickOutside}
                            additionalReferences={[navRef]}
                            configuration={DRAMRenderConfiguration}
                        />

                        <br />
                        <br />

                        <div className='plot-tensor-details'>
                            <div className='legend'>
                                {memoryReport.map((chunk) => (
                                    <div
                                        key={chunk.address}
                                        className={classNames('legend-item', {
                                            dimmed:
                                                selectedTensorAddress !== null &&
                                                selectedTensorAddress !== chunk.address,
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
                                            <div className='format-numbers'>
                                                {prettyPrintAddress(chunk.address, memorySizeL1)}
                                            </div>
                                            <div className='format-numbers keep-left'>({toHex(chunk.address)})</div>
                                            <div className='format-numbers'>{formatSize(chunk.size)} </div>
                                            <div>
                                                {!chunk.empty && details.getTensorForAddress(chunk.address) && (
                                                    <>Tensor {details.getTensorForAddress(chunk.address)?.tensor_id}</>
                                                )}
                                                {chunk.empty && 'Empty space'}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                <hr />
                                {dramTensorsOnly.map((chunk) => (
                                    <div
                                        key={chunk.address}
                                        className={classNames('legend-item', {
                                            dimmed:
                                                selectedTensorAddress !== null &&
                                                selectedTensorAddress !== chunk.address,
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
                                            <div className='format-numbers'>
                                                {prettyPrintAddress(chunk.address, memorySizeL1)}
                                            </div>
                                            <div className='format-numbers keep-left'>({toHex(chunk.address)})</div>
                                            <div className='format-numbers'>{formatSize(chunk.size)} </div>
                                            <div>
                                                {!chunk.empty && details.getTensorForAddress(chunk.address) && (
                                                    <>Tensor {details.getTensorForAddress(chunk.address)?.tensor_id}</>
                                                )}
                                                {chunk.empty && 'Empty space'}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div
                                ref={navRef}
                                className={classNames('producer-consumer', { hidden: selectedTensor === null })}
                            >
                                <div
                                    className={classNames('title', {
                                        hidden:
                                            details.getTensorProducerConsumer(selectedTensor).producers.length === 0,
                                    })}
                                >
                                    <Icon
                                        size={14}
                                        icon={IconNames.EXPORT}
                                        className='producer-icon'
                                    />
                                    Producers
                                </div>
                                {details.getTensorProducerConsumer(selectedTensor).producers.map((op) => (
                                    <div
                                        key={op.id}
                                        className='operation-link'
                                    >
                                        <Link
                                            to={`${ROUTES.OPERATIONS}/${op.id}`}
                                            className={classNames('', { current: operationId === op.id })}
                                        >
                                            {op.id} {op.name}
                                        </Link>
                                    </div>
                                ))}

                                <div
                                    className={classNames('title', {
                                        hidden:
                                            details.getTensorProducerConsumer(selectedTensor).consumers.length === 0,
                                    })}
                                >
                                    <Icon
                                        size={14}
                                        icon={IconNames.IMPORT}
                                        className='consumer-icon'
                                    />{' '}
                                    Consumers
                                </div>
                                {details.getTensorProducerConsumer(selectedTensor).consumers.map((op) => (
                                    <div
                                        key={op.id}
                                        className='operation-link'
                                    >
                                        <Link
                                            to={`${ROUTES.OPERATIONS}/${op.id}`}
                                            className={classNames('', { current: operationId === op.id })}
                                        >
                                            {op.id} {op.name}
                                        </Link>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <hr />

                        <div className='tensor-list'>
                            <div className='inputs'>
                                <h3>Inputs</h3>
                                {details.inputs?.map((tensor) => (
                                    <TensorDetailsComponent
                                        tensor={tensor}
                                        key={tensor.tensor_id}
                                        selectedAddress={selectedTensorAddress}
                                        onTensorClick={onTensorClick}
                                        memorySize={memorySizeL1}
                                    />
                                ))}
                            </div>

                            <div className='outputs'>
                                <h3>Outputs</h3>
                                {details.outputs?.map((tensor) => (
                                    <TensorDetailsComponent
                                        tensor={tensor}
                                        key={tensor.tensor_id}
                                        selectedAddress={selectedTensorAddress}
                                        onTensorClick={onTensorClick}
                                        memorySize={memorySizeL1}
                                    />
                                ))}
                            </div>
                        </div>
                    </>
                ) : (
                    <p className='not-found-message'>Operation {operationId} not found</p>
                )}
            </div>
        </>
    );
};
export default OperationDetailsComponent;
