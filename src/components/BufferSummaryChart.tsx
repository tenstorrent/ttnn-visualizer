// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { UIEvent, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';
import { BufferSummaryAxisConfiguration, BufferSummaryConfiguration } from '../definitions/PlotConfigurations';
import { useBuffers } from '../hooks/useAPI';
import { BufferType } from '../model/BufferType';
import MemoryPlotRenderer from './operation-details/MemoryPlotRenderer';

const PLACEHOLDER_ARRAY_SIZE = 30;
const OPERATION_EL_HEIGHT = 30;
const TOTAL_SHADE_HEIGHT = 0;

function BufferSummaryChart() {
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const { data: buffersByOperation, isLoading } = useBuffers(BufferType.L1);
    const scrollElementRef = useRef(null);

    const memorySize = buffersByOperation
        ? buffersByOperation
              .map((operations) => operations.buffers.map((buffer) => buffer.address + buffer.size))
              .flat()
              .sort((a, b) => b - a)[0]
        : 0;

    const numberOfOperations =
        buffersByOperation && buffersByOperation.length >= 0 ? buffersByOperation.length : PLACEHOLDER_ARRAY_SIZE;

    const virtualizer = useVirtualizer({
        count: buffersByOperation?.length || PLACEHOLDER_ARRAY_SIZE,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: () => OPERATION_EL_HEIGHT,
    });
    const virtualItems = virtualizer.getVirtualItems();

    const handleUserScrolling = (event: UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;

        setHasScrolledFromTop(!(el.scrollTop < OPERATION_EL_HEIGHT / 2));
        setHasScrolledToBottom(el.scrollTop + el.offsetHeight >= el.scrollHeight);
    };

    return buffersByOperation && !isLoading ? (
        <div className='buffer-summary-chart'>
            <div className='buffer-summary-plot-x-axis-container'>
                <p className='x-axis-label'>Memory Address</p>

                <MemoryPlotRenderer
                    className='buffer-summary-plot-x-axis'
                    chartDataList={[
                        [
                            {
                                x: [0],
                                y: [1],
                                type: 'bar',
                                width: [memorySize],
                                name: 'y-axis',
                                marker: {
                                    color: '#343434',
                                },
                            },
                        ],
                    ]}
                    isZoomedIn={false}
                    memorySize={memorySize}
                    configuration={BufferSummaryAxisConfiguration}
                />
            </div>

            <div
                ref={scrollElementRef}
                className={classNames('scrollable-element', {
                    'scroll-shade-top': hasScrolledFromTop,
                    'scroll-shade-bottom': !hasScrolledToBottom && numberOfOperations > virtualItems.length,
                })}
                onScroll={(event) => handleUserScrolling(event)}
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
                                >
                                    <MemoryPlotRenderer
                                        key={operation.id}
                                        className='buffer-summary-plot'
                                        chartDataList={[
                                            operation.buffers.map((buffer) => ({
                                                x: [buffer.address],
                                                y: [operation.id],
                                                type: 'bar',
                                                width: [buffer.size],
                                            })),
                                        ]}
                                        isZoomedIn={false}
                                        memorySize={memorySize}
                                        configuration={BufferSummaryConfiguration}
                                        // onClick={onBufferClick}
                                        // onHover={(data) => setHoveredPoint(data.points[0].x as number)}
                                        // onUnhover={() => setHoveredPoint(null)}
                                    />

                                    <p className='y-axis-tick'>- {operation.id}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    ) : null;
}

export default BufferSummaryChart;
