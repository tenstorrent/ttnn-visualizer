// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';
import { Tooltip } from '@blueprintjs/core';
import { PlotConfiguration, PlotMarker } from '../../definitions/PlotConfigurations';
import MemoryPlotRenderer from '../operation-details/MemoryPlotRenderer';
import BufferSummaryRow from './BufferSummaryRow';
import 'styles/components/BufferSummaryPlot.scss';
import { ScrollLocations } from '../../definitions/VirtualLists';
import useRestoreScrollPosition from '../../hooks/useRestoreScrollPosition';
import useScrollShade from '../../hooks/useScrollShade';
import { BuffersByOperation } from '../../model/APIData';
import useBufferNavigation from '../../hooks/useBufferNavigation';
import BufferSummaryPlotControls from './BufferSummaryPlotControls';
import { TensorDeallocationReport, TensorsByOperationByAddress } from '../../model/BufferSummary';
import { CHART_DATA, OPERATION_EL_HEIGHT, TOTAL_SHADE_HEIGHT } from '../../definitions/BufferSummary';

interface BufferSummaryVirtualizedListProps {
    operations: BuffersByOperation[];
    tensorListByOperation: TensorsByOperationByAddress;
    isZoomedIn: boolean;
    showMemoryLayout: boolean;
    scrollLocation: ScrollLocations;
    memorySize: number;
    zoomStart: number;
    zoomEnd: number;
    memoryPadding: number;
    axisConfiguration: PlotConfiguration;
    markers?: PlotMarker[];
    getTensorDeallocationReport?: (operationId: number) => TensorDeallocationReport[];
    getOperationTooltipContent: (operation: BuffersByOperation) => string;
    renderOperationLink: (operation: BuffersByOperation) => React.ReactNode;
}

const EMPTY_TENSOR_DEALLOCATION_REPORT: TensorDeallocationReport[] = [];
const DEFAULT_GET_TENSOR_DEALLOCATION_REPORT = () => EMPTY_TENSOR_DEALLOCATION_REPORT;

function BufferSummaryVirtualizedList({
    operations,
    tensorListByOperation,
    isZoomedIn,
    showMemoryLayout,
    scrollLocation,
    memorySize,
    zoomStart,
    zoomEnd,
    memoryPadding,
    axisConfiguration,
    markers,
    getTensorDeallocationReport = DEFAULT_GET_TENSOR_DEALLOCATION_REPORT,
    getOperationTooltipContent,
    renderOperationLink,
}: BufferSummaryVirtualizedListProps) {
    const { getListState, updateListState } = useRestoreScrollPosition(scrollLocation);
    const { hasScrolledFromTop, hasScrolledToBottom, updateScrollShade, shadeClasses } = useScrollShade();
    const scrollElementRef = useRef<HTMLDivElement>(null);

    const { scrollOffset: restoredOffset, measurementsCache: restoredMeasurementsCache } =
        useMemo(() => getListState(), [getListState]) ?? {};

    // Disabling warning because it's a known limitation of Tanstack Virtual
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        estimateSize: () => OPERATION_EL_HEIGHT,
        getScrollElement: () => scrollElementRef.current,
        overscan: 10,
        initialMeasurementsCache: restoredMeasurementsCache,
        count: operations.length,
        initialOffset: restoredOffset || 0,
    });

    useBufferNavigation({
        buffersByOperation: operations,
        tensorListByOperation,
        virtualizer,
    });

    const virtualItems = virtualizer.getVirtualItems();
    const virtualHeight = virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT;

    // Store latest values in refs for unmount cleanup
    const scrollOffsetRef = useRef(virtualizer.scrollOffset);
    const measurementsCacheRef = useRef(virtualizer.measurementsCache);

    const handleUserScrolling = useCallback(() => {
        if (scrollElementRef.current) {
            updateScrollShade(scrollElementRef.current);
        }
    }, [updateScrollShade]);

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
    }, [operations, updateListState]);

    return (
        <div className='buffer-summary-chart'>
            <BufferSummaryPlotControls />

            <p className='x-axis-label'>Memory Address</p>

            <div className='chart-position'>
                <MemoryPlotRenderer
                    className='buffer-summary-plot'
                    chartDataList={CHART_DATA}
                    isZoomedIn={isZoomedIn}
                    memorySize={isZoomedIn ? zoomEnd : memorySize}
                    plotZoomRange={isZoomedIn ? [zoomStart - memoryPadding, zoomEnd + memoryPadding] : [0, memorySize]}
                    configuration={axisConfiguration}
                    markers={markers}
                />
            </div>

            <div
                className={classNames('scrollable-element', {
                    [shadeClasses.top]: hasScrolledFromTop,
                    [shadeClasses.bottom]: !hasScrolledToBottom && operations.length > virtualItems.length,
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
                            const operation = operations[virtualRow.index];

                            return operation ? (
                                <div
                                    className='buffer-summary-plot-container'
                                    key={virtualRow.key}
                                    data-index={virtualRow.index}
                                >
                                    <BufferSummaryRow
                                        buffers={operation.buffers}
                                        memoryStart={isZoomedIn ? zoomStart : 0}
                                        memoryEnd={isZoomedIn ? zoomEnd : memorySize}
                                        memoryPadding={memoryPadding}
                                        tensorList={tensorListByOperation.get(operation.id)}
                                        tensorDeallocationReport={getTensorDeallocationReport(operation.id)}
                                        showMemoryLayout={showMemoryLayout}
                                    />

                                    <Tooltip
                                        content={getOperationTooltipContent(operation)}
                                        className='y-axis-tick'
                                    >
                                        {renderOperationLink(operation)}
                                    </Tooltip>
                                </div>
                            ) : null;
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default BufferSummaryVirtualizedList;
