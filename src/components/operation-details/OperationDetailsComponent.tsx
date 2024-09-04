// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React, { forwardRef, useRef, useState } from 'react';
import { PlotMouseEvent } from 'plotly.js';
import { Icon, Switch } from '@blueprintjs/core';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { IconNames } from '@blueprintjs/icons';
import { toast } from 'react-toastify';
import { useAtom } from 'jotai';
import { FragmentationEntry } from '../../model/APIData';
import MemoryPlotRenderer from './MemoryPlotRenderer';
import { useOperationDetails, useOperationsList, usePreviousOperationDetails } from '../../hooks/useAPI';
import 'styles/components/OperationDetailsComponent.scss';
import { isEqual } from '../../functions/math';
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
import { MemoryLegendElement } from './MemoryLegendElement';
import Collapsible from '../Collapsible';
import OperationArguments from '../OperationArguments';
import { selectedTensorAddressAtom } from '../../store/app';
import useOutsideClick from '../../hooks/useOutsideClick';
import { getBufferColor } from '../../functions/colorGenerator';
import ToastTensorMessage from './ToastTensorMessage';
import DeviceOperations from '../DeviceOperations';

interface OperationDetailsProps {
    operationId: number;
}

const MINIMAL_MEMORY_RANGE_OFFSET = 0.98;
const MINIMAL_DRAM_MEMORY_RANGE_OFFSET = 0.9998;

const OperationDetailsComponent: React.FC<OperationDetailsProps> = ({ operationId }) => {
    const { data: operations } = useOperationsList();
    const [zoomedInView, setZoomedInView] = useState(false);

    const {
        operationDetails: { data: operationDetails, isLoading, status },
    } = useOperationDetails(operationId);

    const { data: previousOperationDetails, isLoading: isPrevLoading } =
        usePreviousOperationDetails(operationId).operationDetails;

    const [selectedTensorAddress, setSelectedTensorAddress] = useAtom(selectedTensorAddressAtom);
    const [selectedTensor, setSelectedTensor] = useState<number | null>(null);
    const [toastId, setToastId] = useState<number | null>(null);

    const onClickOutside = () => {
        setSelectedTensorAddress(null);
        setSelectedTensor(null);

        if (toastId) {
            toast.dismiss(toastId);
            setToastId(null);
        }
    };

    const outsideRefs = useRef<HTMLElement[]>([]);

    useOutsideClick(outsideRefs.current, onClickOutside);

    const operation = operations?.find((op) => op.id === operationId);

    if (isLoading || isPrevLoading || !operationDetails || !previousOperationDetails || !operations) {
        return (
            <>
                <OperationDetailsNavigation
                    operationId={operationId}
                    isLoading={isLoading}
                />
                {status === 'error' && <h3 className='not-found-message'>Operation {operationId} not found</h3>}
            </>
        );
    }

    const details: OperationDetails | null = new OperationDetails(operationDetails, operations);
    const previousDetails: OperationDetails | null = new OperationDetails(previousOperationDetails, operations);

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
        setSelectedTensor(details.getTensorForAddress(address)?.id || null);
        createToast(address);
    };

    const onDramDeltaClick = (event: Readonly<PlotMouseEvent>): void => {
        const index = event.points[0].curveNumber;
        const { address } = dramDeltaObject.memory[index];
        selectTensorByAddress(address);
        setSelectedTensorAddress(address);
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
            // eslint-disable-next-line no-console
            console.log('Are we clicking on L1 small?');
        } else {
            const { address } = memory[index];
            selectTensorByAddress(address);
        }
    };

    const onTensorClick = (address: number | null): void => {
        if (address) {
            const tensor = details.getTensorForAddress(address);
            createToast(address);
            setSelectedTensorAddress(address);

            if (tensor) {
                setSelectedTensor(tensor.id);
            }
        }
    };

    const onLegendClick = (address: number) => {
        selectTensorByAddress(address);
    };

    const createToast = (address: number) => {
        if (toastId) {
            toast.dismiss(toastId);
        }

        const tensor = details.getTensorForAddress(address);
        const tensorId = tensor?.id;

        const toastInstance = toast(
            <ToastTensorMessage
                tensorId={tensorId}
                address={address}
                colour={getBufferColor(address)}
            />,
            {
                position: 'bottom-right',
                hideProgressBar: true,
                closeOnClick: true,
                onClick: () => setToastId(null),
                theme: 'light',
            },
        ) as number;

        setToastId(toastInstance);
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

    // TODO: Look at refactoring this to avoid forwarding refs
    const ForwardedMemoryPlotRenderer = forwardRef(MemoryPlotRenderer);

    function assignRef(el: HTMLElement | null, index: number) {
        if (el) {
            outsideRefs.current[index] = el;
        }
    }

    return (
        <>
            <OperationDetailsNavigation
                operationId={operationId}
                isLoading={isLoading}
            />

            <div className='operation-details-component'>
                {!isLoading && Number.isSafeInteger(operationDetails?.id) ? (
                    <>
                        {details.stack_trace && <StackTrace stackTrace={details.stack_trace} />}

                        <Switch
                            label='Buffer zoom'
                            checked={zoomedInView}
                            onChange={() => setZoomedInView(!zoomedInView)}
                        />

                        <h3>L1 Memory</h3>
                        <ForwardedMemoryPlotRenderer
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
                            ref={(el) => assignRef(el, 0)}
                        />

                        <ForwardedMemoryPlotRenderer
                            title='Current Summarized L1 Report'
                            className={classNames('l1-memory-renderer', { 'empty-plot': chartData.length === 0 })}
                            plotZoomRangeStart={plotZoomRangeStart}
                            plotZoomRangeEnd={plotZoomRangeEnd}
                            chartData={chartData.concat(l1Small.condensedChart)}
                            isZoomedIn={zoomedInView}
                            memorySize={memorySizeL1}
                            onBufferClick={onBufferClick}
                            configuration={L1RenderConfiguration}
                            ref={(el) => assignRef(el, 1)}
                        />

                        {/* <Collapsible */}
                        {/*    label={<h3>DRAM Memory</h3>} */}
                        {/*    contentClassName='full-dram-legend' */}
                        {/*    isOpen={false} */}
                        {/* > */}

                        <ForwardedMemoryPlotRenderer
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
                            ref={(el) => assignRef(el, 2)}
                        />

                        <ForwardedMemoryPlotRenderer
                            title='Current Summarized DRAM Report'
                            className={classNames('dram-memory-renderer', { 'empty-plot': dramData.length === 0 })}
                            plotZoomRangeStart={dramPlotZoomRangeStart}
                            plotZoomRangeEnd={dramPlotZoomRangeEnd}
                            chartData={dramData}
                            isZoomedIn={zoomedInView}
                            memorySize={DRAM_MEMORY_SIZE}
                            onBufferClick={onDramBufferClick}
                            configuration={DRAMRenderConfiguration}
                            ref={(el) => assignRef(el, 3)}
                        />

                        <ForwardedMemoryPlotRenderer
                            title='DRAM Delta (difference between current and previous operation)'
                            className={classNames('dram-memory-renderer', {
                                'empty-plot': dramDeltaObject.chartData.length === 0,
                            })}
                            plotZoomRangeStart={dramPlotZoomRangeStart}
                            plotZoomRangeEnd={dramPlotZoomRangeEnd}
                            chartData={dramDeltaObject.chartData}
                            isZoomedIn={zoomedInView}
                            memorySize={DRAM_MEMORY_SIZE}
                            onBufferClick={onDramDeltaClick}
                            configuration={DRAMRenderConfiguration}
                            ref={(el) => assignRef(el, 4)}
                        />

                        <br />
                        <br />
                        {/* </Collapsible> */}
                        <div className='plot-tensor-details'>
                            <div className='legend'>
                                {memoryReport.map((chunk) => (
                                    <MemoryLegendElement
                                        chunk={chunk}
                                        key={chunk.address}
                                        memSize={memorySizeL1}
                                        selectedTensorAddress={selectedTensorAddress}
                                        operationDetails={details}
                                        onLegendClick={onLegendClick}
                                    />
                                ))}
                                <hr />
                                {dramTensorsOnly.map((chunk) => (
                                    <MemoryLegendElement
                                        chunk={chunk}
                                        key={chunk.address}
                                        memSize={DRAM_MEMORY_SIZE}
                                        selectedTensorAddress={selectedTensorAddress}
                                        operationDetails={details}
                                        onLegendClick={onLegendClick}
                                    />
                                ))}
                                <Collapsible
                                    label='Full DRAM Legend'
                                    contentClassName='full-dram-legend'
                                    isOpen={false}
                                >
                                    {dramMemoryReport.map((chunk) => (
                                        <MemoryLegendElement
                                            chunk={chunk}
                                            key={chunk.address}
                                            memSize={DRAM_MEMORY_SIZE}
                                            selectedTensorAddress={selectedTensorAddress}
                                            operationDetails={details}
                                            onLegendClick={onLegendClick}
                                        />
                                    ))}
                                </Collapsible>
                            </div>

                            <div
                                ref={(el) => assignRef(el, 5)}
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
                                        {operationId === op.id ? (
                                            <span className='selected-tensor'>
                                                {op.id} {op.name}
                                            </span>
                                        ) : (
                                            <Link
                                                to={`${ROUTES.OPERATIONS}/${op.id}`}
                                                className={classNames('', { current: operationId === op.id })}
                                            >
                                                {op.id} {op.name}
                                            </Link>
                                        )}
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
                                        {operationId === op.id ? (
                                            <span className='selected-tensor'>
                                                {op.id} {op.name}
                                            </span>
                                        ) : (
                                            <Link
                                                to={`${ROUTES.OPERATIONS}/${op.id}`}
                                                className={classNames('', { current: operationId === op.id })}
                                            >
                                                {op.id} {op.name}
                                            </Link>
                                        )}
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
                                        key={tensor.id}
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
                                        key={tensor.id}
                                        selectedAddress={selectedTensorAddress}
                                        onTensorClick={onTensorClick}
                                        memorySize={memorySizeL1}
                                    />
                                ))}
                            </div>
                        </div>

                        {operation?.arguments && (
                            <>
                                <hr />

                                <div className='arguments-wrapper'>
                                    <OperationArguments operation={operation} />

                                    {operation?.device_operations && (
                                        <DeviceOperations deviceOperations={operation.device_operations} />
                                    )}
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    <p className='not-found-message'>Operation {operationId} not found</p>
                )}
            </div>
        </>
    );
};

export default OperationDetailsComponent;
