// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useMemo, useRef, useState } from 'react';
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
import { SCROLL_TOLERANCE_PX, ScrollLocations } from '../../definitions/ScrollPositions';
import useRestoreScrollPosition from '../../hooks/useRestoreScrollPosition';

const PLACEHOLDER_ARRAY_SIZE = 30;
const OPERATION_EL_HEIGHT = 20; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 20; // Height in px of 'scroll-shade' pseudo elements
const MEMORY_ZOOM_PADDING_RATIO = 0.01;

interface BufferSummaryPlotRendererProps {
    uniqueBuffersByOperationList: BuffersByOperationData[];
    tensorListByOperation: TensorsByOperationByAddress;
}

function BufferSummaryPlotRenderer({
    uniqueBuffersByOperationList,
    tensorListByOperation,
}: BufferSummaryPlotRendererProps) {
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const [activeRow, setActiveRow] = useState<number | null>(null);
    const [showDeallocationReport, setShowDeallocationReport] = useAtom(showDeallocationReportAtom);
    const [showHex, setShowHex] = useAtom(showHexAtom);
    const deviceId = useAtomValue(selectedDeviceAtom) || 0;
    const [renderMemoryLayout, setRenderMemoryLayout] = useAtom(renderMemoryLayoutAtom);
    const [isZoomedIn, setIsZoomedIn] = useAtom(showBufferSummaryZoomedAtom);
    const { data: devices, isLoading: isLoadingDevices } = useDevices();
    const scrollElementRef = useRef<HTMLDivElement>(null);
    const { data: operations } = useOperationsList();
    const [showMemoryRegions, setShowMemoryRegions] = useAtom(showMemoryRegionsAtom);
    const navigate = useNavigate();

    const l1StartMarker = useGetL1StartMarker();
    const l1SmallMarker = useGetL1SmallMarker();

    const numberOfOperations = useMemo(
        () =>
            uniqueBuffersByOperationList && uniqueBuffersByOperationList.length >= 0
                ? uniqueBuffersByOperationList.length
                : PLACEHOLDER_ARRAY_SIZE,
        [uniqueBuffersByOperationList],
    );

    const { lateDeallocationsByOperation: nondeallocatedTensorsByOperationId } =
        useGetTensorDeallocationReportByOperation();

    const getMemorySize = () =>
        !isLoadingDevices && devices ? devices[deviceId]?.worker_l1_size : L1_DEFAULT_MEMORY_SIZE;

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

    const zoomedMemorySizeStart = zoomedMemorySize[0] || 0;
    const zoomedMemorySizeEnd = zoomedMemorySize[1] || memorySize;
    const memoryPadding = (zoomedMemorySizeEnd - zoomedMemorySizeStart) * MEMORY_ZOOM_PADDING_RATIO;

    const virtualizer = useVirtualizer({
        count: uniqueBuffersByOperationList?.length || PLACEHOLDER_ARRAY_SIZE,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: () => OPERATION_EL_HEIGHT,
        overscan: 20,
    });
    const virtualItems = virtualizer.getVirtualItems();

    const { updateScrollPosition } = useRestoreScrollPosition(virtualizer, ScrollLocations.BUFFER_SUMMARY);

    const handleUserScrolling = () => {
        updateScrollShade();
    };

    const updateScrollShade = () => {
        if (scrollElementRef.current) {
            const { scrollTop, offsetHeight, scrollHeight } = scrollElementRef.current;

            setHasScrolledFromTop(scrollTop > 0 + SCROLL_TOLERANCE_PX);

            const scrollBottom = scrollTop + offsetHeight;

            setHasScrolledToBottom(scrollBottom >= scrollHeight - SCROLL_TOLERANCE_PX);
        }
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
                    'scroll-shade-top': hasScrolledFromTop,
                    'scroll-shade-bottom': !hasScrolledToBottom && numberOfOperations > virtualItems.length,
                })}
                onScroll={handleUserScrolling}
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
