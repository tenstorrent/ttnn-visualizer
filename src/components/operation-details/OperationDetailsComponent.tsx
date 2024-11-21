// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React, { useState } from 'react';
import { Button, ButtonGroup, Intent, Position, Switch, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import { useOperationDetails, useOperationsList, usePreviousOperationDetails } from '../../hooks/useAPI';
import 'styles/components/OperationDetailsComponent.scss';
import StackTrace from './StackTrace';
import OperationDetailsNavigation from '../OperationDetailsNavigation';
import { OperationDetails } from '../../model/OperationDetails';
import { CONDENSED_PLOT_CHUNK_COLOR, PlotMouseEventCustom } from '../../definitions/PlotConfigurations';
import {
    isDramActiveAtom,
    isL1ActiveAtom,
    selectedAddressAtom,
    selectedTensorAtom,
    showHexAtom,
} from '../../store/app';
import ProducerConsumersData from './ProducerConsumersData';
import isValidNumber from '../../functions/isValidNumber';
import TensorVisualisationComponent from '../tensor-sharding-visualization/TensorVisualisationComponent';
import GlobalSwitch from '../GlobalSwitch';
import GraphComponent from './DeviceOperationsGraphComponent';
import { BufferType } from '../../model/BufferType';
import DRAMPlots from './DRAMPlots';
import L1Plots from './L1Plots';
import TensorDetailsList from './TensorDetailsList';
import OperationArguments from '../OperationArguments';
import DeviceOperationsFullRender from './DeviceOperationsFullRender';
import useToasts from '../../hooks/useToasts';

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
    const [selectedTensorId, setSelectedTensorId] = useAtom(selectedTensorAtom);
    const [tensixFullVisualisationOpen, setTensixFullVisualisationOpen] = useState(false);
    const [tensixIOVisualisationOpen, setTensixIOVisualisationOpen] = useState(false);
    const [deviceOperationsGraphOpen, setDeviceOperationsGraphOpen] = useState(false);

    const { createToast, resetToasts } = useToasts();

    const onClickOutside = () => {
        resetToasts();
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

    const inputOutputList = details.inputs.concat(details.outputs);
    const inputOutputAddressList: string = inputOutputList.map((tensor) => tensor.address).join(',');

    return (
        <>
            <OperationDetailsNavigation
                operationId={operationId}
                isLoading={isLoading}
            />

            <div className='operation-details-component'>
                {(selectedAddress || isValidNumber(selectedTensorId)) && (
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

                        {details.device_operations && details.deviceOperations.length > 0 && (
                            <>
                                <h3>Device operations</h3>
                                <Button
                                    icon={IconNames.Graph}
                                    intent={Intent.PRIMARY}
                                    onClick={() => setDeviceOperationsGraphOpen(true)}
                                >
                                    Device operations graph view
                                </Button>
                                <DeviceOperationsFullRender
                                    deviceOperations={details.device_operations}
                                    details={details}
                                    onLegendClick={onLegendClick}
                                />
                            </>
                        )}
                        {operation?.arguments && (
                            <>
                                <hr />

                                <div className='arguments-wrapper'>
                                    <OperationArguments operation={operation} />
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    <p className='not-found-message'>Operation {operationId} not found</p>
                )}
                {deviceOperationsGraphOpen && details.device_operations && (
                    <GraphComponent
                        data={details.device_operations}
                        open={deviceOperationsGraphOpen}
                        onClose={() => setDeviceOperationsGraphOpen(false)}
                    />
                )}
            </div>
        </>
    );
};

export default OperationDetailsComponent;
