// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useEffect, useRef, useState } from 'react';
import { Button, ButtonGroup, ButtonVariant, Intent, Label, RangeSlider, Size, Switch } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import classNames from 'classnames';
import {
    useGetL1SmallMarker,
    useGetL1StartMarker,
    useGetTensorDeallocationReportByOperation,
    useOperationDetails,
    useOperationsList,
    usePreviousOperationDetails,
} from '../../hooks/useAPI';
import 'styles/components/OperationDetailsComponent.scss';
import StackTrace from './StackTrace';
import OperationDetailsNavigation from '../OperationDetailsNavigation';
import { OperationDetails } from '../../model/OperationDetails';
import { L1RenderZoomoutConfiguration, PlotMouseEventCustom } from '../../definitions/PlotConfigurations';
import {
    isFullStackTraceAtom,
    renderMemoryLayoutAtom,
    selectedAddressAtom,
    selectedTensorAtom,
    showDeallocationReportAtom,
    showHexAtom,
    showMemoryRegionsAtom,
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
import useBufferFocus from '../../hooks/useBufferFocus';
import { StackTraceLanguage } from '../../definitions/StackTrace';
import { L1_DEFAULT_MEMORY_SIZE } from '../../definitions/L1MemorySize';
import MemoryPlotRenderer from './MemoryPlotRenderer';

interface OperationDetailsProps {
    operationId: number;
}

const OperationDetailsComponent: React.FC<OperationDetailsProps> = ({ operationId }) => {
    const [renderMemoryLayoutPattern, setRenderMemoryLayout] = useAtom(renderMemoryLayoutAtom);
    const [selectedAddress, setSelectedAddress] = useAtom(selectedAddressAtom);
    const [selectedTensorId, setSelectedTensorId] = useAtom(selectedTensorAtom);
    const [showHex, setShowHex] = useAtom(showHexAtom);
    const [showMemoryRegions, setShowMemoryRegions] = useAtom(showMemoryRegionsAtom);
    const [showFullStackTrace, setShowFullStackTrace] = useAtom(isFullStackTraceAtom);
    const [showDeallocationReport, setShowDeallocationReport] = useAtom(showDeallocationReportAtom);

    const [zoomedInViewMainMemory, setZoomedInViewMainMemory] = useState(false);
    const [showCircularBuffer, setShowCircularBuffer] = useState(false);
    const [showL1Small, setShowL1Small] = useState(false);
    const [tensixFullVisualisationOpen, setTensixFullVisualisationOpen] = useState(false);
    const [tensixIOVisualisationOpen, setTensixIOVisualisationOpen] = useState(false);
    const [deviceOperationsGraphOpen, setDeviceOperationsGraphOpen] = useState(false);
    const [isL1Active, setIsL1Active] = useState(true);
    const [isDramActive, setIsDramActive] = useState(false);

    const [zoomRangeStart, setZoomRangeStart] = useState(0);
    const [zoomRangeEnd, setZoomRangeEnd] = useState(0);

    const { data: operations } = useOperationsList();
    const l1start = useGetL1StartMarker();
    const l1end = useGetL1SmallMarker();

    const didInitZoomRange = useRef(false);

    const {
        operationDetails: { data: operationDetails, isLoading, status },
    } = useOperationDetails(operationId);
    const { data: previousOperationDetails, isLoading: isPrevLoading } =
        usePreviousOperationDetails(operationId).operationDetails;
    const { createToast, resetToasts } = useBufferFocus();

    const onClickOutside = () => {
        resetToasts();
    };

    const operation = operations?.find((op) => op.id === operationId);
    const { lateDeallocationsByOperation } = useGetTensorDeallocationReportByOperation();

    useEffect(() => {
        // TODO: look into resetting this value
        if (didInitZoomRange.current) {
            return;
        }
        if (!isLoading && !isPrevLoading && operationDetails && previousOperationDetails) {
            const { plotZoomRangeStart, plotZoomRangeEnd } = calculatePlotZoomRange();
            setZoomRangeStart(plotZoomRangeStart);
            setZoomRangeEnd(plotZoomRangeEnd);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading, isPrevLoading, operationDetails, previousOperationDetails]);

    useEffect(() => {
        didInitZoomRange.current = false;
    }, [operationId]);

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
    const deallocationReport = lateDeallocationsByOperation.get(operation?.id || -1) || [];
    const details: OperationDetails | null = new OperationDetails(
        operationDetails,
        operations,
        deallocationReport,
        { l1start, l1end },
        {
            renderPattern: renderMemoryLayoutPattern,
            lateDeallocation: showDeallocationReport,
        },
    );

    const previousDetails: OperationDetails | null = new OperationDetails(previousOperationDetails, operations, [], {
        l1start,
        l1end,
    });

    const l1Small = details.memoryData(BufferType.L1_SMALL);

    const { memory, cbChartDataByOperation } = details.memoryData();
    const { memory: previousMemory } = previousDetails.memoryData();

    const { memorySizeL1 } = details;

    const calculatePlotZoomRange = () => {
        let plotZoomRangeStart = Math.min(
            memory[0]?.address || memorySizeL1,
            previousMemory[0]?.address || memorySizeL1,
        );
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
        return { plotZoomRangeStart, plotZoomRangeEnd };
    };

    const { plotZoomRangeStart, plotZoomRangeEnd } = calculatePlotZoomRange();

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
    const { chartData } = details.memoryData();

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
                        {details.stack_trace && (
                            <StackTrace
                                stackTrace={details.stack_trace}
                                language={StackTraceLanguage.PYTHON}
                                isInitiallyExpanded={showFullStackTrace}
                                onExpandChange={() => setShowFullStackTrace(!showFullStackTrace)}
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

                        <div className='controls'>
                            <Switch
                                label='Buffer zoom'
                                checked={zoomedInViewMainMemory}
                                onChange={() => {
                                    setZoomedInViewMainMemory(!zoomedInViewMainMemory);
                                }}
                            />
                            <Switch
                                label='Show Circular Buffers Details'
                                checked={showCircularBuffer}
                                disabled={cbChartDataByOperation.size === 0}
                                onChange={() => {
                                    setShowCircularBuffer(!showCircularBuffer);
                                }}
                            />
                            <GlobalSwitch
                                label='Mark late tensor deallocations'
                                checked={showDeallocationReport}
                                onChange={() => {
                                    setShowDeallocationReport(!showDeallocationReport);
                                }}
                            />
                            <GlobalSwitch
                                label='Tensor memory layout overlay'
                                checked={renderMemoryLayoutPattern}
                                onChange={() => {
                                    setRenderMemoryLayout(!renderMemoryLayoutPattern);
                                }}
                            />

                            <Switch
                                label={!showL1Small ? 'Show L1 Small' : 'Hide L1 Small'}
                                checked={showL1Small}
                                disabled={l1Small.condensed.size === 0}
                                onChange={() => {
                                    setShowL1Small(!showL1Small);
                                }}
                            />

                            <GlobalSwitch
                                label='Hex axis labels'
                                checked={showHex}
                                onChange={() => {
                                    setShowHex(!showHex);
                                }}
                            />
                            <GlobalSwitch
                                label='Memory regions'
                                checked={showMemoryRegions}
                                onChange={() => {
                                    setShowMemoryRegions(!showMemoryRegions);
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

                        {isL1Active && operation && (
                            <>
                                <h3>L1 Memory</h3>

                                <ButtonGroup className='core-view-buttons'>
                                    <Button
                                        className='right-icon-small'
                                        text='All allocations per core'
                                        icon={IconNames.LAYOUT_GRID}
                                        onClick={() => {
                                            setTensixFullVisualisationOpen(true);
                                        }}
                                        disabled={tensixFullVisualisationOpen}
                                        intent={Intent.PRIMARY}
                                        endIcon={IconNames.OPEN_APPLICATION}
                                    />

                                    <Button
                                        className='right-icon-small'
                                        text='Input/Output allocations per core'
                                        icon={IconNames.FLOW_REVIEW}
                                        onClick={() => {
                                            setTensixIOVisualisationOpen(true);
                                        }}
                                        disabled={tensixIOVisualisationOpen}
                                        intent={Intent.PRIMARY}
                                        endIcon={IconNames.OPEN_APPLICATION}
                                    />
                                </ButtonGroup>

                                <>
                                    {tensixIOVisualisationOpen && (
                                        <TensorVisualisationComponent
                                            title={`${operationId} ${operation.name}  (${operation.operationFileIdentifier}) inputs/outputs`}
                                            operationId={operationId}
                                            address={inputOutputAddressList}
                                            bufferType={BufferType.L1}
                                            zoomRange={[zoomRangeStart, zoomRangeEnd]}
                                            isOpen={tensixIOVisualisationOpen}
                                            onClose={() => setTensixIOVisualisationOpen(false)}
                                            tensorByAddress={details.tensorListByAddress}
                                        />
                                    )}
                                    {tensixFullVisualisationOpen && (
                                        <TensorVisualisationComponent
                                            title={`${operationId} ${operation.name}  (${operation.operationFileIdentifier})  detailed memory report`}
                                            operationId={operationId}
                                            bufferType={BufferType.L1}
                                            zoomRange={[zoomRangeStart, zoomRangeEnd]}
                                            isOpen={tensixFullVisualisationOpen}
                                            onClose={() => setTensixFullVisualisationOpen(false)}
                                            tensorByAddress={details.tensorListByAddress}
                                        />
                                    )}

                                    <Label
                                        className='memory-zoom-range-label'
                                        disabled={!zoomedInViewMainMemory}
                                    >
                                        L1 memory zoom range:
                                        <Button
                                            className='memory-zoom-range-reset'
                                            disabled={
                                                !zoomedInViewMainMemory ||
                                                (plotZoomRangeStart === zoomRangeStart &&
                                                    plotZoomRangeEnd === zoomRangeEnd)
                                            }
                                            size={Size.SMALL}
                                            variant={ButtonVariant.MINIMAL}
                                            icon={IconNames.RESET}
                                            intent={Intent.WARNING}
                                            onClick={() => {
                                                setZoomRangeStart(plotZoomRangeStart);
                                                setZoomRangeEnd(plotZoomRangeEnd);
                                            }}
                                        />
                                        {!zoomedInViewMainMemory && '(Requires buffer zoom to be enabled)'}
                                    </Label>

                                    <MemoryPlotRenderer
                                        className={classNames('l1-memory-renderer zoom-reference', {
                                            disabled: !zoomedInViewMainMemory,
                                        })}
                                        plotZoomRange={[plotZoomRangeStart, plotZoomRangeEnd]}
                                        chartDataList={[chartData]}
                                        isZoomedIn={zoomedInViewMainMemory}
                                        memorySize={memorySizeL1}
                                        configuration={L1RenderZoomoutConfiguration}
                                    />

                                    <RangeSlider
                                        min={plotZoomRangeStart}
                                        max={plotZoomRangeEnd}
                                        disabled={!zoomedInViewMainMemory}
                                        intent={Intent.WARNING}
                                        labelStepSize={
                                            (plotZoomRangeEnd - plotZoomRangeStart) / 3 || L1_DEFAULT_MEMORY_SIZE
                                        }
                                        labelRenderer={(value) => {
                                            return showHex ? `0x${value.toString(16).toUpperCase()}` : `${value}`;
                                        }}
                                        value={[zoomRangeStart, zoomRangeEnd]}
                                        onChange={(value: number[]) => {
                                            setZoomRangeStart(value[0]);
                                            setZoomRangeEnd(value[1]);
                                        }}
                                        className='memory-zoom-range'
                                    />

                                    <L1Plots
                                        operationDetails={details}
                                        previousOperationDetails={previousDetails}
                                        zoomedInViewMainMemory={zoomedInViewMainMemory}
                                        plotZoomRangeStart={zoomRangeStart}
                                        plotZoomRangeEnd={zoomRangeEnd}
                                        showCircularBuffer={showCircularBuffer}
                                        showL1Small={showL1Small}
                                        onBufferClick={onBufferClick}
                                        onLegendClick={onLegendClick}
                                    />
                                </>
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
                            plotZoomRangeStart={zoomRangeStart}
                            plotZoomRangeEnd={zoomRangeEnd}
                            onTensorClick={onTensorClick}
                        />

                        {details.device_operations && (
                            <>
                                <h3>Device operations</h3>
                                {details.device_operations && details.device_operations.length && (
                                    <Button
                                        icon={IconNames.Graph}
                                        intent={Intent.PRIMARY}
                                        onClick={() => setDeviceOperationsGraphOpen(true)}
                                    >
                                        Device operations graph view
                                    </Button>
                                )}
                                <DeviceOperationsFullRender
                                    deviceOperations={details.device_operations}
                                    details={details}
                                    onLegendClick={onLegendClick}
                                />
                            </>
                        )}

                        {operation?.arguments && (
                            <div className='arguments-wrapper'>
                                <OperationArguments operation={operation} />
                            </div>
                        )}
                    </>
                ) : (
                    <p className='not-found-message'>Operation {operationId} not found</p>
                )}
                {deviceOperationsGraphOpen && details.device_operations && details.device_operations.length && (
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
