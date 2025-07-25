// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { UIEvent, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';
import { Switch, Tooltip } from '@blueprintjs/core';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue } from 'jotai';
import {
    BufferSummaryAxisConfiguration,
    L1_SMALL_MARKER_COLOR,
    L1_START_MARKER_COLOR,
} from '../../definitions/PlotConfigurations';
import {
    BuffersByOperationData,
    useDevices,
    useGetL1SmallMarker,
    useGetL1StartMarker,
    useOperationsList,
} from '../../hooks/useAPI';
import MemoryPlotRenderer from '../operation-details/MemoryPlotRenderer';
import LoadingSpinner from '../LoadingSpinner';
import BufferSummaryRow from './BufferSummaryRow';
import 'styles/components/BufferSummaryPlot.scss';
import ROUTES from '../../definitions/Routes';
import isValidNumber from '../../functions/isValidNumber';
import { TensorDeallocationReport, TensorsByOperationByAddress } from '../../model/BufferSummary';
import {
    renderMemoryLayoutAtom,
    selectedDeviceAtom,
    showBufferSummaryZoomedAtom,
    showHexAtom,
    showMemoryRegionsAtom,
} from '../../store/app';
import GlobalSwitch from '../GlobalSwitch';
import { L1_DEFAULT_MEMORY_SIZE } from '../../definitions/L1MemorySize';
import { ScrollLocations } from '../../definitions/ScrollPositions';
import useRestoreScrollPosition from '../../hooks/useRestoreScrollPosition';
import { Operation } from '../../model/APIData';

const PLACEHOLDER_ARRAY_SIZE = 30;
const OPERATION_EL_HEIGHT = 20; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 20; // Height in px of 'scroll-shade' pseudo elements
const MEMORY_ZOOM_PADDING_RATIO = 0.01;

interface BufferSummaryPlotRendererProps {
    buffersByOperation: BuffersByOperationData[];
    tensorListByOperation: TensorsByOperationByAddress;
}

function BufferSummaryPlotRenderer({ buffersByOperation, tensorListByOperation }: BufferSummaryPlotRendererProps) {
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const [activeRow, setActiveRow] = useState<number | null>(null);
    const [showDeallocationReport, setShowDeallocationReport] = useState(true);
    const [showHex, setShowHex] = useAtom(showHexAtom);
    const deviceId = useAtomValue(selectedDeviceAtom) || 0;
    const [renderMemoryLayout, setRenderMemoryLayout] = useAtom(renderMemoryLayoutAtom);
    const [isZoomedIn, setIsZoomedIn] = useAtom(showBufferSummaryZoomedAtom);
    const { data: devices, isLoading: isLoadingDevices } = useDevices();
    const scrollElementRef = useRef(null);
    const { data: operations } = useOperationsList();
    const [showMemoryRegions, setShowMemoryRegions] = useAtom(showMemoryRegionsAtom);
    const navigate = useNavigate();
    const operationsById = useMemo(() => {
        const map = new Map<number, Operation>();
        operations?.forEach((operation) => {
            map.set(operation.id, operation);
        });
        return map;
    }, [operations]);

    const l1StartMarker = useGetL1StartMarker();
    const l1SmallMarker = useGetL1SmallMarker();

    const numberOfOperations = useMemo(
        () =>
            buffersByOperation && buffersByOperation.length >= 0 ? buffersByOperation.length : PLACEHOLDER_ARRAY_SIZE,
        [buffersByOperation],
    );

    const nondeallocatedTensorsByOperationId = useMemo(() => {
        const getLastValidConsumer = (consumers: number[]) => {
            const list = [...consumers];
            while (list && list.length > 0) {
                const lastConsumerOperationId = list.sort().pop() || -1;
                const lastConsumerName = operationsById.get(lastConsumerOperationId)?.name || '';

                if (lastConsumerOperationId > -1 && !lastConsumerName.includes('ttnn.deallocate')) {
                    return { lastConsumerOperationId, lastConsumerName };
                }
            }
            return { lastConsumerName: '', lastConsumerOperationId: -1 };
        };
        const result = new Map<number, TensorDeallocationReport[]>();
        if (showDeallocationReport) {
            tensorListByOperation.forEach((tensorsMap, operationId) => {
                tensorsMap.forEach((tensor, address) => {
                    if (tensor.id && tensor.consumers && tensor.consumers.length > 0) {
                        const { lastConsumerOperationId, lastConsumerName } = getLastValidConsumer(tensor.consumers);
                        if (lastConsumerOperationId !== null && lastConsumerOperationId < operationId) {
                            if (!result.has(operationId)) {
                                result.set(operationId, []);
                            }
                            const list: TensorDeallocationReport[] = result.get(operationId)!;
                            list.push({
                                id: tensor.id,
                                address,
                                consumerName: lastConsumerName,
                                lastConsumerOperationId,
                                lastOperationId: operationId,
                            });
                            result.set(operationId, list);
                        }
                    }
                });
            });
        }
        return result;
    }, [operationsById, showDeallocationReport, tensorListByOperation]);

    const getMemorySize = () =>
        !isLoadingDevices && devices ? devices[deviceId]?.worker_l1_size : L1_DEFAULT_MEMORY_SIZE;

    // TODO: Multi device support
    const memorySize = useMemo(getMemorySize, [deviceId, devices, isLoadingDevices]);

    const zoomedMemorySize = useMemo(() => {
        let minValue: undefined | number;
        let maxValue: undefined | number;

        buffersByOperation?.forEach((operation) =>
            operation.buffers.forEach((buffer) => {
                minValue = isValidNumber(minValue) ? Math.min(minValue, buffer.address) : buffer.address;
                maxValue = isValidNumber(maxValue)
                    ? Math.max(maxValue, buffer.address + buffer.size)
                    : buffer.address + buffer.size;
            }),
        );

        return minValue && maxValue ? [minValue, maxValue] : [0, memorySize];
    }, [buffersByOperation, memorySize]);

    const zoomedMemorySizeStart = zoomedMemorySize[0] || 0;
    const zoomedMemorySizeEnd = zoomedMemorySize[1] || memorySize;
    const memoryPadding = (zoomedMemorySizeEnd - zoomedMemorySizeStart) * MEMORY_ZOOM_PADDING_RATIO;

    const virtualizer = useVirtualizer({
        count: buffersByOperation?.length || PLACEHOLDER_ARRAY_SIZE,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: () => OPERATION_EL_HEIGHT,
        overscan: 20,
    });
    const virtualItems = virtualizer.getVirtualItems();

    const { updateScrollPosition } = useRestoreScrollPosition(virtualizer, ScrollLocations.BUFFER_SUMMARY);

    const handleUserScrolling = (event: UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;

        setHasScrolledFromTop(!(el.scrollTop < OPERATION_EL_HEIGHT / 2));
        setHasScrolledToBottom(el.scrollTop + el.offsetHeight >= el.scrollHeight);
    };

    const handleNavigateToOperation = (event: React.MouseEvent<HTMLAnchorElement>, path: string, index: number) => {
        event.preventDefault();
        updateScrollPosition(index);
        navigate(path);
    };

    const memoryRegionsMarkers = showMemoryRegions
        ? [
              { color: L1_SMALL_MARKER_COLOR, address: l1SmallMarker, label: 'L1 SMALL' },
              { color: L1_START_MARKER_COLOR, address: l1StartMarker, label: '' },
          ]
        : [];

    return buffersByOperation && !isLoadingDevices && tensorListByOperation ? (
        <div className='buffer-summary-chart'>
            <div className='controls'>
                <Switch
                    label='Buffer zoom'
                    checked={isZoomedIn}
                    onChange={() => {
                        setIsZoomedIn(!isZoomedIn);
                    }}
                />
                <Switch
                    label='Mark late tensor deallocations'
                    checked={showDeallocationReport}
                    onChange={() => {
                        setShowDeallocationReport(!showDeallocationReport);
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
                    label='Tensor memory layout overlay'
                    checked={renderMemoryLayout}
                    onChange={() => {
                        setRenderMemoryLayout(!renderMemoryLayout);
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

            <p className='x-axis-label'>Memory Address</p>

            <div className='chart-position'>
                <MemoryPlotRenderer
                    className='buffer-summary-plot'
                    chartDataList={[
                        [
                            {
                                x: [0],
                                y: [1],
                                type: 'bar',
                                width: [0],
                                marker: {
                                    color: 'transparent',
                                },
                            },
                        ],
                    ]}
                    isZoomedIn={isZoomedIn}
                    memorySize={isZoomedIn ? zoomedMemorySizeEnd : memorySize}
                    plotZoomRange={
                        isZoomedIn
                            ? [zoomedMemorySizeStart - memoryPadding, zoomedMemorySizeEnd + memoryPadding]
                            : [0, memorySize]
                    }
                    configuration={BufferSummaryAxisConfiguration}
                    markers={memoryRegionsMarkers}
                />
            </div>

            <div
                className={classNames('scrollable-element', {
                    'scroll-shade-top': hasScrolledFromTop,
                    'scroll-shade-bottom': !hasScrolledToBottom && numberOfOperations > virtualItems.length,
                })}
                onScroll={(event) => handleUserScrolling(event)}
                ref={scrollElementRef}
            >
                <div
                    style={{
                        // Div is sized to the maximum required to render all list items minus our shade element heights
                        height: virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT,
                    }}
                >
                    <div
                        className='list-container'
                        style={{
                            // Tracks scroll position
                            transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                        }}
                    >
                        {virtualItems.map((virtualRow) => {
                            const operation = buffersByOperation[virtualRow.index];

                            return (
                                <div
                                    className='buffer-summary-plot-container'
                                    key={virtualRow.key}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    onMouseEnter={() => setActiveRow(operation.id)}
                                    onMouseLeave={() => setActiveRow(null)}
                                >
                                    <BufferSummaryRow
                                        className={classNames({ 'is-active': operation.id === activeRow })}
                                        buffers={operation.buffers}
                                        memoryStart={isZoomedIn ? zoomedMemorySizeStart : 0}
                                        memoryEnd={isZoomedIn ? zoomedMemorySizeEnd : memorySize}
                                        memoryPadding={memoryPadding}
                                        tensorList={tensorListByOperation.get(operation.id)!}
                                        tensorDeallocationReport={
                                            nondeallocatedTensorsByOperationId.get(operation.id) || []
                                        }
                                        showMemoryLayout={renderMemoryLayout}
                                    />

                                    <Tooltip
                                        content={`${operation.id} ${operation.name} (${operations?.find((op) => op.id === operation.id)?.operationFileIdentifier})`}
                                        className='y-axis-tick'
                                    >
                                        <a
                                            href={`${ROUTES.OPERATIONS}/${operation.id}`}
                                            onClick={(event) =>
                                                handleNavigateToOperation(
                                                    event,
                                                    `${ROUTES.OPERATIONS}/${operation.id}`,
                                                    virtualRow.index,
                                                )
                                            }
                                        >
                                            {operation.id}&nbsp;{operation.name}
                                        </a>
                                    </Tooltip>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    ) : (
        <LoadingSpinner />
    );
}

export default BufferSummaryPlotRenderer;
