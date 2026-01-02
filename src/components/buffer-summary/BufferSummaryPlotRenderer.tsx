// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    useDevices,
    useGetL1SmallMarker,
    useGetL1StartMarker,
    useGetTensorDeallocationReportByOperation,
    useOperationsList,
} from '../../hooks/useAPI';
import MemoryPlotRenderer from '../operation-details/MemoryPlotRenderer';
import LoadingSpinner from '../LoadingSpinner';
import BufferSummaryRow from './BufferSummaryRow';
import 'styles/components/BufferSummaryPlot.scss';
import ROUTES from '../../definitions/Routes';
import isValidNumber from '../../functions/isValidNumber';
import { TensorsByOperationByAddress } from '../../model/BufferSummary';
import {
    renderMemoryLayoutAtom,
    selectedDeviceAtom,
    showBufferSummaryZoomedAtom,
    showDeallocationReportAtom,
    showHexAtom,
    showMemoryRegionsAtom,
} from '../../store/app';
import GlobalSwitch from '../GlobalSwitch';
import { L1_DEFAULT_MEMORY_SIZE } from '../../definitions/L1MemorySize';
import { ScrollLocations } from '../../definitions/ScrollPositions';
import useRestoreScrollPosition from '../../hooks/useRestoreScrollPosition';
import useScrollShade from '../../hooks/useScrollShade';

import { BuffersByOperation } from '../../model/APIData';

const PLACEHOLDER_ARRAY_SIZE = 50;
const OPERATION_EL_HEIGHT = 20; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 20; // Total height in px of 'scroll-shade' pseudo elements
const MEMORY_ZOOM_PADDING_RATIO = 0.01;

interface BufferSummaryPlotRendererProps {
    uniqueBuffersByOperationList: BuffersByOperation[];
    tensorListByOperation: TensorsByOperationByAddress;
}

function BufferSummaryPlotRenderer({
    uniqueBuffersByOperationList,
    tensorListByOperation,
}: BufferSummaryPlotRendererProps) {
    const [showDeallocationReport, setShowDeallocationReport] = useAtom(showDeallocationReportAtom);
    const [renderMemoryLayout, setRenderMemoryLayout] = useAtom(renderMemoryLayoutAtom);
    const [showHex, setShowHex] = useAtom(showHexAtom);
    const [isZoomedIn, setIsZoomedIn] = useAtom(showBufferSummaryZoomedAtom);
    const [showMemoryRegions, setShowMemoryRegions] = useAtom(showMemoryRegionsAtom);
    const deviceId = useAtomValue(selectedDeviceAtom) || 0;
    const [activeRow, setActiveRow] = useState<number | null>(null);

    const { data: devices, isLoading: isLoadingDevices } = useDevices();
    const { data: operations } = useOperationsList();
    const navigate = useNavigate();
    const scrollElementRef = useRef<HTMLDivElement>(null);
    const l1StartMarker = useGetL1StartMarker();
    const l1SmallMarker = useGetL1SmallMarker();
    const { getListState, updateListState } = useRestoreScrollPosition(ScrollLocations.BUFFER_SUMMARY);
    const { hasScrolledFromTop, hasScrolledToBottom, updateScrollShade, shadeClasses } = useScrollShade();

    const { scrollOffset: restoredOffset, measurementsCache: restoredMeasurementsCache } =
        useMemo(() => getListState(), [getListState]) ?? {};

    const virtualizer = useVirtualizer({
        estimateSize: () => OPERATION_EL_HEIGHT,
        getScrollElement: () => scrollElementRef.current,
        overscan: 20,
        initialMeasurementsCache: restoredMeasurementsCache,
        count: uniqueBuffersByOperationList?.length || PLACEHOLDER_ARRAY_SIZE,
        initialOffset: restoredOffset || 0,
    });

    const virtualItems = virtualizer.getVirtualItems();
    const virtualHeight = virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT;

    // Store latest values in refs for unmount cleanup
    const scrollOffsetRef = useRef(virtualizer.scrollOffset);
    const measurementsCacheRef = useRef(virtualizer.measurementsCache);

    const getMemorySize = () =>
        !isLoadingDevices && devices ? devices[deviceId]?.worker_l1_size : L1_DEFAULT_MEMORY_SIZE;

    const numberOfOperations = useMemo(
        () =>
            uniqueBuffersByOperationList && uniqueBuffersByOperationList.length >= 0
                ? uniqueBuffersByOperationList.length
                : PLACEHOLDER_ARRAY_SIZE,
        [uniqueBuffersByOperationList],
    );

    const { lateDeallocationsByOperation: nondeallocatedTensorsByOperationId } =
        useGetTensorDeallocationReportByOperation();

    // TODO: Multi device support
    const memorySize = useMemo(getMemorySize, [deviceId, devices, isLoadingDevices]);

    const zoomedMemorySize = useMemo(() => {
        let minValue: undefined | number;
        let maxValue: undefined | number;

        uniqueBuffersByOperationList?.forEach((operation) =>
            operation.buffers.forEach((buffer) => {
                minValue = isValidNumber(minValue) ? Math.min(minValue, buffer.address) : buffer.address;
                maxValue = isValidNumber(maxValue)
                    ? Math.max(maxValue, buffer.address + buffer.size)
                    : buffer.address + buffer.size;
            }),
        );

        return minValue && maxValue ? [minValue, maxValue] : [0, memorySize];
    }, [uniqueBuffersByOperationList, memorySize]);

    const handleUserScrolling = useCallback(() => {
        if (scrollElementRef.current) {
            updateScrollShade(scrollElementRef.current);
        }
    }, [updateScrollShade]);

    const handleNavigateToOperation = (event: React.MouseEvent<HTMLAnchorElement>, path: string) => {
        event.preventDefault();
        navigate(path);
    };

    // Keep stored refs updated
    useEffect(() => {
        scrollOffsetRef.current = virtualizer.scrollOffset;
    }, [virtualizer.scrollOffset]);

    useEffect(() => {
        measurementsCacheRef.current = virtualizer.measurementsCache;
    }, [virtualizer.measurementsCache]);

    // Update stored list state on unmount
    useEffect(() => {
        return () => {
            updateListState({
                scrollOffset: scrollOffsetRef.current || 0,
                measurementsCache: measurementsCacheRef.current,
            });
        };
    }, [updateListState, uniqueBuffersByOperationList]);

    const memoryRegionsMarkers = showMemoryRegions
        ? [
              { color: L1_SMALL_MARKER_COLOR, address: l1SmallMarker, label: 'L1 SMALL' },
              { color: L1_START_MARKER_COLOR, address: l1StartMarker, label: '' },
          ]
        : [];
    const zoomedMemorySizeStart = zoomedMemorySize[0] || 0;
    const zoomedMemorySizeEnd = zoomedMemorySize[1] || memorySize;
    const memoryPadding = (zoomedMemorySizeEnd - zoomedMemorySizeStart) * MEMORY_ZOOM_PADDING_RATIO;

    return uniqueBuffersByOperationList && !isLoadingDevices && tensorListByOperation ? (
        <div className='buffer-summary-chart'>
            <div className='controls'>
                <Switch
                    label='Buffer zoom'
                    checked={isZoomedIn}
                    onChange={() => {
                        setIsZoomedIn(!isZoomedIn);
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
                    [shadeClasses.top]: hasScrolledFromTop,
                    [shadeClasses.bottom]: !hasScrolledToBottom && numberOfOperations > virtualItems.length,
                })}
                onScroll={handleUserScrolling}
                ref={scrollElementRef}
            >
                <div
                    style={{
                        // Div is sized to the maximum required to render all list items minus our shade element heights
                        height: virtualHeight,
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
                            const operation = uniqueBuffersByOperationList[virtualRow.index];

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
                                            showDeallocationReport
                                                ? nondeallocatedTensorsByOperationId.get(operation.id) || []
                                                : []
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
                                                handleNavigateToOperation(event, `${ROUTES.OPERATIONS}/${operation.id}`)
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
