// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React, { Fragment, useState } from 'react';
import { Button, ButtonGroup, Icon, Intent, Position, Switch, Tooltip } from '@blueprintjs/core';
import classNames from 'classnames';
import { IconNames } from '@blueprintjs/icons';
import { toast } from 'react-toastify';
import { useAtom } from 'jotai';
import { useOperationDetails, useOperationsList, usePreviousOperationDetails } from '../../hooks/useAPI';
import 'styles/components/OperationDetailsComponent.scss';
import StackTrace from './StackTrace';
import OperationDetailsNavigation from '../OperationDetailsNavigation';
import { OperationDetails } from '../../model/OperationDetails';
import {
    CONDENSED_PLOT_CHUNK_COLOR,
    MAX_LEGEND_LENGTH,
    PlotMouseEventCustom,
} from '../../definitions/PlotConfigurations';
import { MemoryLegendElement } from './MemoryLegendElement';
import OperationArguments from '../OperationArguments';
import { isDramActiveAtom, isL1ActiveAtom, selectedAddressAtom, showHexAtom } from '../../store/app';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import ToastTensorMessage from './ToastTensorMessage';
import ProducerConsumersData from './ProducerConsumersData';
import isValidNumber from '../../functions/isValidNumber';
import TensorVisualisationComponent from '../tensor-sharding-visualization/TensorVisualisationComponent';
import GlobalSwitch from '../GlobalSwitch';
import TensorDetailsList from './TensorDetailsList';
import { BufferType } from '../../model/BufferType';
import DRAMPlots from './DRAMPlots';
import L1Plots from './L1Plots';

interface OperationDetailsProps {
    operationId: number;
}
const OperationDetailsComponent: React.FC<OperationDetailsProps> = ({ operationId }) => {
    const { data: operations } = useOperationsList();
    const [zoomedInViewMainMemory, setZoomedInViewMainMemory] = useState(false);
    const [showCircularBuffer, setShowCircularBuffer] = useState(false);
    const [showHex, setShowHex] = useAtom(showHexAtom);
    const {
        operationDetails: { data: operationDetails, isLoading, status },
    } = useOperationDetails(operationId);

    const { data: previousOperationDetails, isLoading: isPrevLoading } =
        usePreviousOperationDetails(operationId).operationDetails;

    const [isL1Active, setIsL1Active] = useAtom(isL1ActiveAtom);
    const [isDramActive, setIsDramActive] = useAtom(isDramActiveAtom);
    const [selectedAddress, setSelectedAddress] = useAtom(selectedAddressAtom);
    const [selectedTensorId, setSelectedTensorId] = useState<number | null>(null);
    const [toastId, setToastId] = useState<number | null>(null);
    const [tensixFullVisualisationOpen, setTensixFullVisualisationOpen] = useState(false);
    const [tensixIOVisualisationOpen, setTensixIOVisualisationOpen] = useState(false);

    const onClickOutside = () => {
        setSelectedAddress(null);
        setSelectedTensorId(null);

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

    const { memory, cbChartDataByOperation } = details.memoryData();
    const { memory: previousMemory } = previousDetails.memoryData();

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

    if (plotZoomRangeEnd < plotZoomRangeStart) {
        plotZoomRangeStart = 0;
        plotZoomRangeEnd = memorySizeL1;
    }

    const updateBufferFocus = (address?: number, tensorId?: number): void => {
        setSelectedAddress(address ?? null);
        setSelectedTensorId(tensorId ?? null);
        createToast(address, tensorId);
    };

    const onDramDeltaClick = (event: Readonly<PlotMouseEventCustom>): void => {
        const { address, tensor } = event.points[0].data.memoryData;
        updateBufferFocus(address, tensor?.id);
    };

    const onDramBufferClick = (event: Readonly<PlotMouseEventCustom>): void => {
        const { address, tensor } = event.points[0].data.memoryData;
        updateBufferFocus(address, tensor?.id);
    };

    const onBufferClick = (event: Readonly<PlotMouseEventCustom>): void => {
        const { address, tensor } = event.points[0].data.memoryData;
        updateBufferFocus(address, tensor?.id);
    };

    const onTensorClick = (address?: number, tensorId?: number): void => {
        updateBufferFocus(address, tensorId);
    };

    const onLegendClick = (address: number, tensorId?: number) => {
        updateBufferFocus(address, tensorId);
    };

    const createToast = (address?: number, tensorId?: number) => {
        if (toastId) {
            toast.dismiss(toastId);
        }

        let colour = getTensorColor(tensorId);

        if (address && !colour) {
            colour = getBufferColor(address);
        }

        const toastInstance = toast(
            <ToastTensorMessage
                tensorId={tensorId}
                address={address}
                colour={colour}
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

    const inputOutputList = details.inputs.concat(details.outputs);
    const inputOutputAddressList: string = inputOutputList.map((tensor) => tensor.address).join(',');

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
                {(selectedAddress || selectedTensorId) && (
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
                    <div
                        className='outside-click'
                        onClick={onClickOutside}
                    />
                )}
                {!isLoading && isValidNumber(operationDetails?.id) ? (
                    <>
                        {details.stack_trace && <StackTrace stackTrace={details.stack_trace} />}
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

                            <GlobalSwitch
                                label='Hex axis labels'
                                checked={showHex}
                                onChange={() => {
                                    setShowHex(!showHex);
                                }}
                            />
                        </div>

                        {!isL1Active && !isDramActive && (
                            <p className='no-buffer-type-selected'>No buffer types selected.</p>
                        )}

                        {selectedTensorId ? (
                            <ProducerConsumersData
                                selectedTensor={
                                    inputOutputList.find((t) => t.id === selectedTensorId) ||
                                    details.getTensorForAddress(selectedAddress ?? 0)
                                }
                                details={details}
                                operationId={operationId}
                            />
                        ) : null}

                        {isL1Active && (
                            <>
                                <h3>
                                    L1 Memory{' '}
                                    <Tooltip
                                        content='Visualize io tensix cores'
                                        placement={Position.TOP}
                                    >
                                        <Button
                                            title='Visualize io tensix cores'
                                            icon={IconNames.FLOW_REVIEW}
                                            intent={Intent.SUCCESS}
                                            minimal
                                            small
                                            onClick={() => {
                                                setTensixIOVisualisationOpen(true);
                                            }}
                                        />
                                    </Tooltip>
                                    <Tooltip
                                        content='Visualize all tensix cores'
                                        placement={Position.TOP}
                                    >
                                        <Button
                                            icon={IconNames.LAYOUT_GRID}
                                            intent={Intent.SUCCESS}
                                            minimal
                                            small
                                            onClick={() => {
                                                setTensixFullVisualisationOpen(true);
                                            }}
                                        />
                                    </Tooltip>
                                    {tensixIOVisualisationOpen && (
                                        <TensorVisualisationComponent
                                            title={`Operation ${operationId} inputs/outputs`}
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
                                            title={`Operation ${operationId} detailed memory report`}
                                            operationId={operationId}
                                            bufferType={BufferType.L1}
                                            zoomRange={[plotZoomRangeStart, plotZoomRangeEnd]}
                                            isOpen={tensixFullVisualisationOpen}
                                            onClose={() => setTensixFullVisualisationOpen(false)}
                                            tensorByAddress={details.historicalTensorListByAddress}
                                        />
                                    )}
                                </h3>

                                <L1Plots
                                    operationDetails={details}
                                    previousOperationDetails={previousDetails}
                                    zoomedInViewMainMemory={zoomedInViewMainMemory}
                                    plotZoomRangeStart={plotZoomRangeStart}
                                    plotZoomRangeEnd={plotZoomRangeEnd}
                                    showCircularBuffer={showCircularBuffer}
                                    onBufferClick={onBufferClick}
                                    onLegendClick={onLegendClick}
                                />
                            </>
                        )}

                        {isDramActive && (
                            <>
                                <h3>DRAM</h3>

                                <DRAMPlots
                                    operationDetails={details}
                                    previousOperationDetails={previousDetails}
                                    zoomedInViewMainMemory={zoomedInViewMainMemory}
                                    onDramBufferClick={onDramBufferClick}
                                    onDramDeltaClick={onDramDeltaClick}
                                    onLegendClick={onLegendClick}
                                />
                            </>
                        )}

                        <hr />

                        <TensorDetailsList
                            operationDetails={details}
                            plotZoomRangeStart={plotZoomRangeStart}
                            plotZoomRangeEnd={plotZoomRangeEnd}
                            onTensorClick={onTensorClick}
                        />

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
                                                        selectedTensorAddress={selectedAddress}
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
                                                        selectedTensorAddress={selectedAddress}
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

                                    {/* TODO: we shouldn't be rendering this raw but lets keep this commented out for debug purposes for now */}
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
