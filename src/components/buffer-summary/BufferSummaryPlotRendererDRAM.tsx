// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';
import { Tooltip } from '@blueprintjs/core';
import { Link } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { PlotData } from 'plotly.js';
import { BufferSummaryAxisConfiguration } from '../../definitions/PlotConfigurations';
import MemoryPlotRenderer from '../operation-details/MemoryPlotRenderer';
import LoadingSpinner from '../LoadingSpinner';
import BufferSummaryRow from './BufferSummaryRow';
import 'styles/components/BufferSummaryPlot.scss';
import ROUTES from '../../definitions/Routes';
import { renderMemoryLayoutAtom, showBufferSummaryZoomedAtom } from '../../store/app';
import { DRAM_MEMORY_SIZE } from '../../definitions/DRAMMemorySize';
import { ScrollLocations } from '../../definitions/VirtualLists';
import useRestoreScrollPosition from '../../hooks/useRestoreScrollPosition';
import useScrollShade from '../../hooks/useScrollShade';

import { BuffersByOperation } from '../../model/APIData';
import useBufferNavigation from '../../hooks/useBufferNavigation';
import BufferSummaryPlotControls from './BufferSummaryPlotControls';
import { TensorsByOperationByAddress } from '../../model/BufferSummary';

const PLACEHOLDER_ARRAY_SIZE = 50;
const OPERATION_EL_HEIGHT = 20; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 20; // Height in px of 'scroll-shade' pseudo elements
const MEMORY_ZOOM_PADDING_RATIO = 0.01;
const MEMORY_SIZE = DRAM_MEMORY_SIZE;

const CHART_DATA: Partial<PlotData>[][] = [
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
];

interface BufferSummaryPlotRendererDRAMProps {
    uniqueBuffersByOperationList: BuffersByOperation[];
    tensorListByOperation: TensorsByOperationByAddress;
}

function BufferSummaryPlotRendererDRAM({
    uniqueBuffersByOperationList,
    tensorListByOperation,
}: BufferSummaryPlotRendererDRAMProps) {
    const [activeRow, setActiveRow] = useState<number | null>(null);
    const isZoomedIn = useAtomValue(showBufferSummaryZoomedAtom);
    const showMemoryLayout = useAtomValue(renderMemoryLayoutAtom);

    const { getListState, updateListState } = useRestoreScrollPosition(ScrollLocations.BUFFER_SUMMARY_DRAM);
    const { hasScrolledFromTop, hasScrolledToBottom, updateScrollShade, shadeClasses } = useScrollShade();
    const scrollElementRef = useRef(null);

    const segmentedChartData: BuffersByOperation[][] = useMemo(() => {
        if (isZoomedIn) {
            return getSplitBuffers(uniqueBuffersByOperationList);
        }

        return [uniqueBuffersByOperationList];
    }, [uniqueBuffersByOperationList, isZoomedIn]);

    const numberOfOperations = useMemo(
        () =>
            segmentedChartData[0] && segmentedChartData[0].length >= 0
                ? segmentedChartData[0].length
                : PLACEHOLDER_ARRAY_SIZE,
        [segmentedChartData],
    );

    const zoomedMemoryOptions = useMemo(
        () =>
            segmentedChartData.map((segment) => {
                const buffers = segment.flatMap((op) => op.buffers);
                const zoomStart = buffers[0].address;
                const zoomEnd = buffers[buffers.length - 1].address + buffers[buffers.length - 1].size;

                return {
                    start: zoomStart,
                    end: zoomEnd,
                    padding: (zoomEnd - zoomStart) * MEMORY_ZOOM_PADDING_RATIO,
                };
            }),
        [segmentedChartData],
    );

    const { scrollOffset: restoredOffset, measurementsCache: restoredMeasurementsCache } =
        useMemo(() => getListState(), [getListState]) ?? {};

    // Disabling warning because it's a known limitation of Tanstack Virtual
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        estimateSize: () => OPERATION_EL_HEIGHT,
        getScrollElement: () => scrollElementRef.current,
        overscan: 20,
        initialMeasurementsCache: restoredMeasurementsCache,
        count: segmentedChartData[0]?.length || PLACEHOLDER_ARRAY_SIZE,
        initialOffset: restoredOffset || 0,
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

    useBufferNavigation({
        buffersByOperation: segmentedChartData[0],
        tensorListByOperation,
        virtualizer,
    });

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

    return uniqueBuffersByOperationList && tensorListByOperation ? (
        <div className='buffer-summary-chart'>
            <BufferSummaryPlotControls />

            <p className='x-axis-label'>Memory Address</p>

            {segmentedChartData.slice(0, 1).map((segment, index) => (
                <Fragment key={`${segment[index].name}-${index}`}>
                    <div className='chart-position'>
                        <MemoryPlotRenderer
                            className='buffer-summary-plot'
                            chartDataList={CHART_DATA}
                            isZoomedIn={isZoomedIn}
                            memorySize={isZoomedIn ? zoomedMemoryOptions[index].end : MEMORY_SIZE}
                            plotZoomRange={
                                isZoomedIn
                                    ? [
                                          zoomedMemoryOptions[index].start - zoomedMemoryOptions[index].padding,
                                          zoomedMemoryOptions[index].end + zoomedMemoryOptions[index].padding,
                                      ]
                                    : [0, MEMORY_SIZE]
                            }
                            configuration={BufferSummaryAxisConfiguration}
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
                                    const operation = segment[virtualRow.index];

                                    return operation ? (
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
                                                // operationId={operation.id}
                                                memoryStart={isZoomedIn ? zoomedMemoryOptions[index].start : 0}
                                                memoryEnd={isZoomedIn ? zoomedMemoryOptions[index].end : MEMORY_SIZE}
                                                memoryPadding={zoomedMemoryOptions[index].padding}
                                                tensorList={tensorListByOperation.get(operation.id)}
                                                showMemoryLayout={showMemoryLayout}
                                            />

                                            <Tooltip
                                                content={`${operation.id} ${operation.name}`}
                                                className='y-axis-tick'
                                            >
                                                <Link to={`${ROUTES.OPERATIONS}/${operation.id}`}>
                                                    {operation.id}&nbsp;{operation.name}
                                                </Link>
                                            </Tooltip>
                                        </div>
                                    ) : null;
                                })}
                            </div>
                        </div>
                    </div>
                </Fragment>
            ))}
        </div>
    ) : (
        <LoadingSpinner />
    );
}

const SPLIT_THRESHOLD_RATIO = 2;

function getSplitBuffers(data: BuffersByOperation[]): BuffersByOperation[][] {
    const buffers = data
        .flatMap((op) => op.buffers.map((buffer) => ({ ...buffer, opName: op.name, opId: op.id })))
        .sort((a, b) => a.address - b.address);

    const lastDataPoint = buffers.at(-1);
    const splitThreshold = lastDataPoint ? (lastDataPoint.address + lastDataPoint.size) / SPLIT_THRESHOLD_RATIO : 0;

    const result = [];
    let currentArray = [];

    for (let i = 0; i < buffers.length; i++) {
        const thisPosition = buffers[i].address;
        const lastPosition = buffers[i - 1]?.address ?? 0;

        if (thisPosition - lastPosition > splitThreshold) {
            result.push(currentArray);
            currentArray = [];
        }

        currentArray.push(buffers[i]);
    }

    if (currentArray.length > 0) {
        result.push(currentArray);
    }

    return result.map((buffersGroup) => {
        const operationsMap = new Map<number, BuffersByOperation>();

        buffersGroup.forEach((buffer) => {
            const { opId, opName, ...originalBuffer } = buffer;
            if (!operationsMap.has(opId)) {
                operationsMap.set(opId, { id: opId, name: opName, buffers: [] });
            }
            operationsMap.get(opId)!.buffers.push(originalBuffer);
        });

        return Array.from(operationsMap.values());
    });
}

export default BufferSummaryPlotRendererDRAM;
