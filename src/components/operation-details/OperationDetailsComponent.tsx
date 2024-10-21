// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React, { Fragment, useState } from 'react';
import { Button, ButtonGroup, Icon, Intent, Switch } from '@blueprintjs/core';
import classNames from 'classnames';
import { IconNames } from '@blueprintjs/icons';
import { toast } from 'react-toastify';
import { useAtom } from 'jotai';
import { FragmentationEntry } from '../../model/APIData';
import MemoryPlotRenderer from './MemoryPlotRenderer';
import { useOperationDetails, useOperationsList, usePreviousOperationDetails } from '../../hooks/useAPI';
import 'styles/components/OperationDetailsComponent.scss';
import { isEqual } from '../../functions/math';
import StackTrace from './StackTrace';
import OperationDetailsNavigation from '../OperationDetailsNavigation';
import { OperationDetails } from '../../model/OperationDetails';
import { BufferType } from '../../model/BufferType';
import { DRAM_MEMORY_SIZE } from '../../definitions/DRAMMemorySize';
import {
    CBRenderConfiguration,
    CONDENSED_PLOT_CHUNK_COLOR,
    DRAMRenderConfiguration,
    L1RenderConfiguration,
    PlotMouseEventCustom,
} from '../../definitions/PlotConfigurations';
import { MemoryLegendElement } from './MemoryLegendElement';
import OperationArguments from '../OperationArguments';
import { isDramActiveAtom, isL1ActiveAtom, selectedTensorAddressAtom } from '../../store/app';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import ToastTensorMessage from './ToastTensorMessage';
import TensorDetailsComponent from './TensorDetailsComponent';
import ProducerConsumersData from './ProducerConsumersData';
import isValidNumber from '../../functions/isValidNumber';
import TensorVisualisationComponent from '../tensor-sharding-visualization/TensorVisualisationComponent';

interface OperationDetailsProps {
    operationId: number;
}

const MEMORY_ZOOM_PADDING_RATIO = 0.01;
const DRAM_PADDING_RATIO = 0.9998;
const MAX_LEGEND_LENGTH = 20;

const OperationDetailsComponent: React.FC<OperationDetailsProps> = ({ operationId }) => {
    const { data: operations } = useOperationsList();
    const [zoomedInViewMainMemory, setZoomedInViewMainMemory] = useState(false);
    const [zoomedInViewCBMemory, setZoomedInViewCBMemory] = useState(false);
    const [showCircularBuffer, setShowCircularBuffer] = useState(false);
    const {
        operationDetails: { data: operationDetails, isLoading, status },
    } = useOperationDetails(operationId);

    const { data: previousOperationDetails, isLoading: isPrevLoading } =
        usePreviousOperationDetails(operationId).operationDetails;

    const [isL1Active, setIsL1Active] = useAtom(isL1ActiveAtom);
    const [isDramActive, setIsDramActive] = useAtom(isDramActiveAtom);
    const [selectedTensorAddress, setSelectedTensorAddress] = useAtom(selectedTensorAddressAtom);
    const [selectedTensor, setSelectedTensor] = useState<number | null>(null);
    const [toastId, setToastId] = useState<number | null>(null);
    const [tensixFullVisualisationOpen, setTensixFullVisualisationOpen] = useState(false);
    const [tensixIOVisualisationOpen, setTensixIOVisualisationOpen] = useState(false);

    const onClickOutside = () => {
        setSelectedTensorAddress(null);
        setSelectedTensor(null);

        if (toastId) {
            toast.dismiss(toastId);
            setToastId(null);
        }
    };

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

    const { chartData, memory, fragmentation, cbChartData, cbChartDataByOperation } = details.memoryData();
    const { chartData: previousChartData, memory: previousMemory } = previousDetails.memoryData();

    const { chartData: dramData, memory: dramMemory } = details.memoryData(BufferType.DRAM);
    const { chartData: previousDramData, memory: previousDramMemory } = previousDetails.memoryData(BufferType.DRAM);

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

    let plotZoomRangeStart = Math.min(memory[0]?.address || memorySizeL1, previousMemory[0]?.address || memorySizeL1);

    let plotZoomRangeEnd = Math.max(
        memory.length > 0 ? memory[memory.length - 1].address + memory[memory.length - 1].size : 0,
        previousMemory.length > 0
            ? previousMemory[previousMemory.length - 1].address + previousMemory[previousMemory.length - 1].size
            : 0,
    );

    const cbZoomStart = details.deviceOperations
        .map((op) => op.cbList.map((cb) => cb.address))
        .flat()
        .sort((a, b) => a - b)[0];

    const cbZoomEnd = details.deviceOperations
        .map((op) => op.cbList.map((cd) => cd.address + cd.size))
        .flat()
        .sort((a, b) => a - b)
        .reverse()[0];

    const MEMORY_PADDING_CB = (cbZoomEnd - cbZoomStart) * MEMORY_ZOOM_PADDING_RATIO;
    const MEMORY_PADDING_L1 = (plotZoomRangeEnd - plotZoomRangeStart) * MEMORY_ZOOM_PADDING_RATIO;

    if (plotZoomRangeEnd < plotZoomRangeStart) {
        plotZoomRangeStart = 0;
        plotZoomRangeEnd = memorySizeL1;
    }

    let dramPlotZoomRangeStart =
        Math.min(dramMemory[0]?.address || DRAM_MEMORY_SIZE, previousDramMemory[0]?.address || DRAM_MEMORY_SIZE) *
        DRAM_PADDING_RATIO;

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
        (1 / DRAM_PADDING_RATIO);

    if (dramPlotZoomRangeEnd < dramPlotZoomRangeStart) {
        dramPlotZoomRangeStart = 0;
        dramPlotZoomRangeEnd = DRAM_MEMORY_SIZE;
    }

    const selectTensorByAddress = (address: number): void => {
        setSelectedTensorAddress(address);
        setSelectedTensor(details.getTensorForAddress(address)?.id || null);
        createToast(address);
    };

    const onDramDeltaClick = (event: Readonly<PlotMouseEventCustom>): void => {
        const { address } = event.points[0].data.memoryData;
        selectTensorByAddress(address);
    };

    const onDramBufferClick = (event: Readonly<PlotMouseEventCustom>): void => {
        const { address } = event.points[0].data.memoryData;
        selectTensorByAddress(address);
    };

    const onBufferClick = (event: Readonly<PlotMouseEventCustom>): void => {
        const { address } = event.points[0].data.memoryData;
        // TODO: we now have a tensor in event.points[0].data.memoryData.tensor Maybe we should just use that?
        selectTensorByAddress(address);
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
                colour={getTensorColor(tensorId) || getBufferColor(address)}
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

    const inputOutputAddressList: string = details.inputs
        .concat(details.outputs)
        .map((tensor) => tensor.address)
        .join(',');

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

    return (
        <>
            <OperationDetailsNavigation
                operationId={operationId}
                isLoading={isLoading}
            />

            <div className='operation-details-component'>
                {selectedTensorAddress && (
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
                    <div
                        className='outside-click'
                        onClick={onClickOutside}
                    />
                )}
                {!isLoading && isValidNumber(operationDetails?.id) ? (
                    <>
                        {details.stack_trace && <StackTrace stackTrace={details.stack_trace} />}
                        {tensixIOVisualisationOpen && (
                            <TensorVisualisationComponent
                                operationId={operationId}
                                address={inputOutputAddressList}
                                bufferType={BufferType.L1}
                                zoomRange={[plotZoomRangeStart, plotZoomRangeEnd]}
                                isOpen={tensixIOVisualisationOpen}
                                onClose={() => setTensixIOVisualisationOpen(false)}
                                tensorByAddress={details.historicalTensorListByAddress}
                            />
                        )}
                        {tensixFullVisualisationOpen && (
                            <TensorVisualisationComponent
                                operationId={operationId}
                                address={undefined}
                                bufferType={BufferType.L1}
                                zoomRange={[plotZoomRangeStart, plotZoomRangeEnd]}
                                isOpen={tensixFullVisualisationOpen}
                                onClose={() => setTensixFullVisualisationOpen(false)}
                                tensorByAddress={details.historicalTensorListByAddress}
                            />
                        )}
                        <div className='chart-controls'>
                            <ButtonGroup>
                                <Button
                                    intent={isL1Active ? Intent.SUCCESS : Intent.NONE}
                                    onClick={() => setIsL1Active(!isL1Active)}
                                    icon={isL1Active ? IconNames.EYE_OPEN : IconNames.EYE_OFF}
                                >
                                    L1 Memory
                                </Button>
                                <Button
                                    intent={isDramActive ? Intent.SUCCESS : Intent.NONE}
                                    onClick={() => setIsDramActive(!isDramActive)}
                                    icon={isDramActive ? IconNames.EYE_OPEN : IconNames.EYE_OFF}
                                >
                                    DRAM
                                </Button>
                            </ButtonGroup>
                        </div>
                        <div className='zoom-controls'>
                            <Switch
                                label='Buffer zoom'
                                checked={zoomedInViewMainMemory}
                                onChange={() => {
                                    setZoomedInViewMainMemory(!zoomedInViewMainMemory);
                                }}
                            />
                            <Switch
                                label={
                                    !showCircularBuffer
                                        ? 'Show Circular Buffers Details'
                                        : 'Hide Circular Buffers Details'
                                }
                                checked={showCircularBuffer}
                                disabled={cbChartDataByOperation.size === 0}
                                onChange={() => {
                                    setShowCircularBuffer(!showCircularBuffer);
                                }}
                            />
                        </div>

                        {!isL1Active && !isDramActive && (
                            <p className='no-buffer-type-selected'>No buffer types selected.</p>
                        )}

                        {isL1Active && (
                            <>
                                <h3>
                                    L1 Memory{' '}
                                    <Button
                                        title='Visualize io tensix cores'
                                        icon={IconNames.EYE_ON}
                                        minimal
                                        small
                                        onClick={() => {
                                            setTensixIOVisualisationOpen(true);
                                        }}
                                    />
                                    <Button
                                        title='Visualize all tensix cores'
                                        icon={IconNames.EYE_OPEN}
                                        minimal
                                        small
                                        onClick={() => {
                                            setTensixFullVisualisationOpen(true);
                                        }}
                                    />
                                </h3>

                                <MemoryPlotRenderer
                                    title='Previous Summarized L1 Report'
                                    className={classNames('l1-memory-renderer', {
                                        'empty-plot': previousChartData.length === 0,
                                    })}
                                    plotZoomRange={[
                                        plotZoomRangeStart - MEMORY_PADDING_L1,
                                        plotZoomRangeEnd + MEMORY_PADDING_L1,
                                    ]}
                                    chartDataList={[previousChartData]}
                                    isZoomedIn={zoomedInViewMainMemory}
                                    memorySize={memorySizeL1}
                                    configuration={L1RenderConfiguration}
                                />

                                <MemoryPlotRenderer
                                    title='Current Summarized L1 Report'
                                    className={classNames('l1-memory-renderer', {
                                        'empty-plot': chartData.length === 0,
                                    })}
                                    isZoomedIn={zoomedInViewMainMemory}
                                    plotZoomRange={[
                                        plotZoomRangeStart - MEMORY_PADDING_L1,
                                        plotZoomRangeEnd + MEMORY_PADDING_L1,
                                    ]}
                                    chartDataList={[
                                        cbChartData,
                                        chartData,
                                        l1Small.memory.length > 0 ? l1Small.condensedChart : [],
                                    ]}
                                    memorySize={memorySizeL1}
                                    onBufferClick={onBufferClick}
                                    configuration={L1RenderConfiguration}
                                />
                                {showCircularBuffer && cbChartDataByOperation.size > 0 && (
                                    <>
                                        <h3>Device Operations</h3>
                                        <Switch
                                            label='Circular Buffers zoom'
                                            checked={zoomedInViewCBMemory}
                                            onChange={() => {
                                                setZoomedInViewCBMemory(!zoomedInViewCBMemory);
                                            }}
                                        />
                                        {[...cbChartDataByOperation.entries()].map(
                                            ([{ name: deviceOperationName }, plotData]) => (
                                                <>
                                                    <h3 className='circular-buffers-plot-title'>
                                                        <Icon
                                                            className='operation-icon'
                                                            size={13}
                                                            intent={Intent.SUCCESS}
                                                            icon={IconNames.CUBE_ADD}
                                                        />{' '}
                                                        <span>{deviceOperationName}</span>
                                                    </h3>
                                                    <MemoryPlotRenderer
                                                        title=''
                                                        className={classNames('l1-memory-renderer circular-buffers', {
                                                            'empty-plot': plotData.length === 0,
                                                        })}
                                                        chartDataList={[plotData]}
                                                        plotZoomRange={[
                                                            cbZoomStart - MEMORY_PADDING_CB,
                                                            cbZoomEnd + MEMORY_PADDING_CB,
                                                        ]}
                                                        isZoomedIn={zoomedInViewCBMemory}
                                                        memorySize={memorySizeL1}
                                                        configuration={CBRenderConfiguration}
                                                        onBufferClick={onBufferClick}
                                                    />
                                                </>
                                            ),
                                        )}
                                    </>
                                )}

                                <div
                                    className={classNames('legend', {
                                        'lengthy-legend': memoryReport.length > MAX_LEGEND_LENGTH,
                                    })}
                                >
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
                                </div>
                            </>
                        )}

                        {selectedTensorAddress &&
                        selectedTensor &&
                        (details.getTensorForAddress(selectedTensorAddress)?.buffer_type === BufferType.L1 ||
                            details.getTensorForAddress(selectedTensorAddress)?.buffer_type === BufferType.L1_SMALL) ? (
                            <ProducerConsumersData
                                selectedTensor={selectedTensor}
                                details={details}
                                operationId={operationId}
                            />
                        ) : null}

                        {isDramActive && (
                            <>
                                <h3>DRAM</h3>

                                <MemoryPlotRenderer
                                    title={`Previous Summarized DRAM Report ${dramHasntChanged ? ' (No changes)' : ''}  `}
                                    className={classNames('dram-memory-renderer', {
                                        'empty-plot': previousDramData.length === 0,
                                        'identical-plot': dramHasntChanged,
                                    })}
                                    plotZoomRange={[dramPlotZoomRangeStart, dramPlotZoomRangeEnd]}
                                    chartDataList={[previousDramData]}
                                    isZoomedIn={zoomedInViewMainMemory}
                                    memorySize={DRAM_MEMORY_SIZE}
                                    configuration={DRAMRenderConfiguration}
                                />

                                <MemoryPlotRenderer
                                    title='Current Summarized DRAM Report'
                                    className={classNames('dram-memory-renderer', {
                                        'empty-plot': dramData.length === 0,
                                    })}
                                    plotZoomRange={[dramPlotZoomRangeStart, dramPlotZoomRangeEnd]}
                                    chartDataList={[dramData]}
                                    isZoomedIn={zoomedInViewMainMemory}
                                    memorySize={DRAM_MEMORY_SIZE}
                                    onBufferClick={onDramBufferClick}
                                    configuration={DRAMRenderConfiguration}
                                />

                                <MemoryPlotRenderer
                                    title='DRAM Delta (difference between current and previous operation)'
                                    className={classNames('dram-memory-renderer', {
                                        'empty-plot': dramDeltaObject.chartData.length === 0,
                                    })}
                                    plotZoomRange={[dramPlotZoomRangeStart, dramPlotZoomRangeEnd]}
                                    chartDataList={[dramDeltaObject.chartData]}
                                    isZoomedIn={zoomedInViewMainMemory}
                                    memorySize={DRAM_MEMORY_SIZE}
                                    onBufferClick={onDramDeltaClick}
                                    configuration={DRAMRenderConfiguration}
                                />

                                <div
                                    className={classNames('legend', {
                                        'lengthy-legend': dramMemoryReport.length > MAX_LEGEND_LENGTH,
                                    })}
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
                                </div>
                            </>
                        )}

                        {selectedTensorAddress &&
                        selectedTensor &&
                        details.getTensorForAddress(selectedTensorAddress)?.buffer_type === BufferType.DRAM ? (
                            <ProducerConsumersData
                                selectedTensor={selectedTensor}
                                details={details}
                                operationId={operationId}
                            />
                        ) : null}

                        <hr />

                        <div className='tensor-list'>
                            <div className='inputs'>
                                <h3>Inputs</h3>
                                {details.inputs.map((tensor) => (
                                    <TensorDetailsComponent
                                        tensor={tensor}
                                        key={tensor.id}
                                        selectedAddress={selectedTensorAddress}
                                        onTensorClick={onTensorClick}
                                        memorySize={memorySizeL1}
                                        operationId={operationId}
                                        zoomRange={[plotZoomRangeStart, plotZoomRangeEnd]}
                                    />
                                ))}
                            </div>

                            <div className='outputs'>
                                <h3>Outputs</h3>
                                {details.outputs.map((tensor) => (
                                    <TensorDetailsComponent
                                        tensor={tensor}
                                        key={tensor.id}
                                        selectedAddress={selectedTensorAddress}
                                        onTensorClick={onTensorClick}
                                        memorySize={memorySizeL1}
                                        operationId={operationId}
                                        zoomRange={[plotZoomRangeStart, plotZoomRangeEnd]}
                                    />
                                ))}{' '}
                            </div>
                        </div>
                        {details.deviceOperations.length > 0 && (
                            <div className='device-operations'>
                                <hr />
                                <h3>Device operations</h3>

                                {details.deviceOperations.map((deviceOperation, index) => (
                                    // eslint-disable-next-line react/no-array-index-key
                                    <Fragment key={deviceOperation.name + index}>
                                        <h4
                                            className='device-operation-name'
                                            style={{ paddingLeft: `${deviceOperation.indentLevel * 20}px` }}
                                        >
                                            <Icon
                                                className='operation-icon'
                                                size={13}
                                                intent={Intent.SUCCESS}
                                                icon={IconNames.CUBE_ADD}
                                            />
                                            &nbsp;
                                            {deviceOperation.name}
                                        </h4>

                                        {deviceOperation.cbList.length > 0 && (
                                            <div
                                                className={classNames('legend nested-legend', {
                                                    'lengthy-legend': deviceOperation.cbList.length > MAX_LEGEND_LENGTH,
                                                })}
                                                style={{ marginLeft: `${deviceOperation.indentLevel * 20}px` }}
                                            >
                                                <h4>CBs</h4>
                                                {deviceOperation.cbList.map((cb) => (
                                                    <MemoryLegendElement
                                                        chunk={cb}
                                                        key={cb.address}
                                                        memSize={memorySizeL1}
                                                        selectedTensorAddress={selectedTensorAddress}
                                                        operationDetails={details}
                                                        onLegendClick={onLegendClick}
                                                        colorVariance={deviceOperation.colorVariance}
                                                    />
                                                ))}
                                            </div>
                                        )}

                                        {deviceOperation.deallocateCBs && (
                                            <p
                                                className='deallocate-msg'
                                                style={{ marginLeft: `${deviceOperation.indentLevel * 20}px` }}
                                            >
                                                <Icon
                                                    className='operation-icon'
                                                    size={13}
                                                    intent={Intent.NONE}
                                                    icon={IconNames.CUBE_REMOVE}
                                                />
                                                &nbsp; Deallocate circular buffers
                                            </p>
                                        )}

                                        {deviceOperation.bufferList.length > 0 && (
                                            <div
                                                className={classNames('legend nested-legend', {
                                                    'lengthy-legend':
                                                        deviceOperation.bufferList.length > MAX_LEGEND_LENGTH,
                                                })}
                                                style={{ marginLeft: `${deviceOperation.indentLevel * 20}px` }}
                                            >
                                                <h4>Buffer</h4>
                                                {deviceOperation.bufferList.map((buffer) => (
                                                    <MemoryLegendElement
                                                        chunk={buffer}
                                                        key={buffer.address}
                                                        memSize={memorySizeL1}
                                                        selectedTensorAddress={selectedTensorAddress}
                                                        operationDetails={details}
                                                        onLegendClick={onLegendClick}
                                                        bufferType={buffer.type}
                                                        layout={buffer.layout}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                        {deviceOperation.deallocateBuffers && (
                                            <p
                                                className='deallocate-msg'
                                                style={{ marginLeft: `${deviceOperation.indentLevel * 2}em` }}
                                            >
                                                <Icon
                                                    className='operation-icon'
                                                    size={13}
                                                    intent={Intent.NONE}
                                                    icon={IconNames.CUBE_REMOVE}
                                                />
                                                &nbsp; Deallocate buffer
                                            </p>
                                        )}
                                    </Fragment>
                                ))}
                            </div>
                        )}
                        {operation?.arguments && (
                            <>
                                <hr />

                                <div className='arguments-wrapper'>
                                    <OperationArguments operation={operation} />

                                    {/* TODO: we shouldnt be rendering this raw but lets keep this commented out for debug purposes for now */}
                                    {/* {operation?.device_operations && ( */}
                                    {/*    <DeviceOperations deviceOperations={operation.device_operations} /> */}
                                    {/* )} */}
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
