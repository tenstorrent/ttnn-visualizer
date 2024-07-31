import React, { useRef, useState } from 'react';
import { PlotMouseEvent } from 'plotly.js';
import { Icon, Switch } from '@blueprintjs/core';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { IconNames } from '@blueprintjs/icons';
import { getBufferColor } from '../../functions/colorGenerator';
import { FragmentationEntry } from '../../model/APIData';
import L1MemoryRenderer from './L1MemoryRenderer';
import { useOperationDetails, useOperationsList, usePreviousOperationDetails } from '../../hooks/useAPI';
import 'styles/components/OperationDetailsComponent.scss';
import { formatSize, prettyPrintAddress, toHex } from '../../functions/math';
import TensorDetailsComponent from './TensorDetailsComponent';
import StackTrace from './StackTrace';
import OperationDetailsNavigation from '../OperationDetailsNavigation';
import { OperationDetails } from '../../model/OperationDetails';
import ROUTES from '../../definitions/routes';

interface OperationDetailsProps {
    operationId: number;
}

const MINIMAL_MEMORY_RANGE_OFFSET = 0.98;

const OperationDetailsComponent: React.FC<OperationDetailsProps> = ({ operationId }) => {
    const { data: operations } = useOperationsList();
    const [zoomedInView, setZoomedInView] = useState(false);

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
                isLoading={isLoading}
            />
        );
    }

    const details: OperationDetails | null = new OperationDetails(operationDetails);
    details.updateOperationNames(operations);

    const previousDetails: OperationDetails | null = new OperationDetails(previousOperationDetails);
    previousDetails.updateOperationNames(operations);

    const { chartData, memory, fragmentation } = details.memoryData;
    const { chartData: previousChartData, memory: previousMemory } = previousDetails.memoryData;

    const memoryReport: FragmentationEntry[] = [...memory, ...fragmentation].sort((a, b) => a.address - b.address);
    const { memorySize } = details;

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
        setSelectedTensor(details.getTensorForAddress(address)?.tensor_id || null);
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

    return (
        <>
            <OperationDetailsNavigation
                operationId={operationId}
                isLoading={isLoading}
            />

            <div className='operation-details-component'>
                {!isLoading && Number.isSafeInteger(operationDetails?.operation_id) ? (
                    <>
                        {details.stack_trace && <StackTrace stackTrace={details.stack_trace} />}

                        <Switch
                            label={zoomedInView ? 'Full buffer report' : 'Zoom buffer report'}
                            checked={zoomedInView}
                            onChange={() => setZoomedInView(!zoomedInView)}
                        />

                        <L1MemoryRenderer
                            title='Previous Summarized L1 Report'
                            className={classNames('l1-memory-renderer', {
                                'empty-plot': previousChartData.length === 0,
                            })}
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
                            additionalReferences={[navRef]}
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
                                                {prettyPrintAddress(chunk.address, memorySize)}
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
                                        memorySize={memorySize}
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
                                        memorySize={memorySize}
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
