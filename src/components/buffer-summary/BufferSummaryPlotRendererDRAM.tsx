// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { UIEvent, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';
import { Switch } from '@blueprintjs/core';
import { Link } from 'react-router-dom';
import { useAtom } from 'jotai';
import { BufferSummaryAxisConfiguration } from '../../definitions/PlotConfigurations';
import { BuffersByOperationData } from '../../hooks/useAPI';
import MemoryPlotRenderer from '../operation-details/MemoryPlotRenderer';
import LoadingSpinner from '../LoadingSpinner';
import BufferSummaryRow from './BufferSummaryRow';
import 'styles/components/BufferSummaryPlot.scss';
import ROUTES from '../../definitions/routes';
import { TensorsByOperationByAddress } from '../../model/BufferSummary';
import { renderMemoryLayoutAtom, showHexAtom } from '../../store/app';
import GlobalSwitch from '../GlobalSwitch';
import { DRAM_MEMORY_SIZE } from '../../definitions/DRAMMemorySize';

const PLACEHOLDER_ARRAY_SIZE = 30;
const OPERATION_EL_HEIGHT = 20; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 20; // Height in px of 'scroll-shade' pseudo elements
const MEMORY_ZOOM_PADDING_RATIO = 0.01;

interface BufferSummaryPlotRendererDRAMProps {
    buffersByOperation: BuffersByOperationData[];
    tensorListByOperation: TensorsByOperationByAddress;
}

function BufferSummaryPlotRendererDRAM({
    buffersByOperation,
    tensorListByOperation,
}: BufferSummaryPlotRendererDRAMProps) {
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const [showHex, setShowHex] = useAtom(showHexAtom);
    const [renderMemoryLayout, setRenderMemoryLayout] = useAtom(renderMemoryLayoutAtom);
    const [isZoomedIn, setIsZoomedIn] = useState(false);
    const scrollElementRef = useRef(null);

    const numberOfOperations = useMemo(
        () =>
            buffersByOperation && buffersByOperation.length >= 0 ? buffersByOperation.length : PLACEHOLDER_ARRAY_SIZE,
        [buffersByOperation],
    );

    const segmentedChartData: BuffersByOperationData[][] = useMemo(() => {
        if (isZoomedIn) {
            return getSplitBuffers(buffersByOperation);
        }

        return [buffersByOperation];
    }, [buffersByOperation, isZoomedIn]);

    // TODO: Multi device support
    const memorySize = DRAM_MEMORY_SIZE;

    const zoomedMemoryOptions = segmentedChartData.map((segment) => {
        const buffers = segment.flatMap((op) => op.buffers);
        const zoomStart = buffers[0].address;
        const zoomEnd = buffers[buffers.length - 1].address;

        // console.log('zoomedMemoryOptions', zoomedMemoryOptions);

        return {
            start: zoomStart,
            end: zoomEnd,
            padding: (zoomEnd - zoomStart) * MEMORY_ZOOM_PADDING_RATIO,
        };
    });

    const virtualizer = useVirtualizer({
        count: buffersByOperation?.length || PLACEHOLDER_ARRAY_SIZE,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: () => OPERATION_EL_HEIGHT,
        overscan: 20,
    });
    const virtualItems = virtualizer.getVirtualItems();

    const handleUserScrolling = (event: UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;

        setHasScrolledFromTop(!(el.scrollTop < OPERATION_EL_HEIGHT / 2));
        setHasScrolledToBottom(el.scrollTop + el.offsetHeight >= el.scrollHeight);
    };

    return buffersByOperation && tensorListByOperation ? (
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
            </div>

            <p className='x-axis-label'>Memory Address</p>

            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '4rem' }}>
                {segmentedChartData.map((segment, index) => (
                    <div
                        key={`${segment[index].name}-${index}`}
                        style={{ flexBasis: '50%' }}
                    >
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
                                memorySize={isZoomedIn ? zoomedMemoryOptions[index].end : memorySize}
                                plotZoomRange={
                                    isZoomedIn
                                        ? [
                                              zoomedMemoryOptions[index].start - zoomedMemoryOptions[index].padding,
                                              zoomedMemoryOptions[index].end + zoomedMemoryOptions[index].padding,
                                          ]
                                        : [0, memorySize]
                                }
                                configuration={BufferSummaryAxisConfiguration}
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
                                        const operation = segment[virtualRow.index];

                                        return (
                                            <div
                                                className='buffer-summary-plot-container'
                                                key={virtualRow.key}
                                                data-index={virtualRow.index}
                                                ref={virtualizer.measureElement}
                                            >
                                                <BufferSummaryRow
                                                    buffers={operation.buffers}
                                                    operationId={operation.id}
                                                    memoryStart={isZoomedIn ? zoomedMemoryOptions[index].start : 0}
                                                    memoryEnd={isZoomedIn ? zoomedMemoryOptions[index].end : memorySize}
                                                    memoryPadding={zoomedMemoryOptions[index].padding}
                                                    tensorList={tensorListByOperation.get(operation.id)!}
                                                />
                                                <Link
                                                    to={`${ROUTES.OPERATIONS}/${operation.id}`}
                                                    className='y-axis-tick'
                                                >
                                                    {operation.id}
                                                </Link>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    ) : (
        <LoadingSpinner />
    );
}

const SPLIT_THRESHOLD_RATIO = 2;

function getSplitBuffers(data: BuffersByOperationData[]): BuffersByOperationData[][] {
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
        const operationsMap = new Map<number, BuffersByOperationData>();

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
