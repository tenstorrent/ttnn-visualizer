// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { UIEvent, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';
import { Switch } from '@blueprintjs/core';
import { BufferSummaryAxisConfiguration } from '../../definitions/PlotConfigurations';
import { BuffersByOperationData, useBuffers, useDevices, useOperationsList } from '../../hooks/useAPI';
import { BufferType } from '../../model/BufferType';
import MemoryPlotRenderer from '../operation-details/MemoryPlotRenderer';
import LoadingSpinner from '../LoadingSpinner';
import BufferSummaryRow from './BufferSummaryRow';
import { HistoricalTensor, Operation, Tensor } from '../../model/Graph';
import 'styles/components/BufferSummaryPlot.scss';

const PLACEHOLDER_ARRAY_SIZE = 30;
const OPERATION_EL_HEIGHT = 20; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 20; // Height in px of 'scroll-shade' pseudo elements
const MEMORY_ZOOM_PADDING_RATIO = 0.01;

function BufferSummaryPlotRenderer() {
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const [isZoomedIn, setIsZoomedIn] = useState(false);
    const { data: buffersByOperation, isLoading: isLoadingBuffers } = useBuffers(BufferType.L1);
    const { data: operationsList, isLoading: isLoadingOperations } = useOperationsList();
    const { data: devices, isLoading: isLoadingDevices } = useDevices();
    const scrollElementRef = useRef(null);

    const numberOfOperations =
        buffersByOperation && buffersByOperation.length >= 0 ? buffersByOperation.length : PLACEHOLDER_ARRAY_SIZE;

    // Will need refactoring to handle multiple devices
    const memorySize = !isLoadingDevices && devices ? devices[0].worker_l1_size : 0;

    const zoomedMemorySize = useMemo(() => {
        let minValue: undefined | number;
        let maxValue: undefined | number;

        buffersByOperation?.forEach((operation) =>
            operation.buffers.forEach((buffer) => {
                minValue = minValue && !Number.isNaN(minValue) ? Math.min(minValue, buffer.address) : buffer.address;
                maxValue =
                    maxValue && !Number.isNaN(maxValue)
                        ? Math.max(maxValue, buffer.address + buffer.size)
                        : buffer.address + buffer.size;
            }),
        );

        return minValue && maxValue ? [minValue, maxValue] : [0, memorySize];
    }, [buffersByOperation, memorySize]);

    const zoomedMemorySizeStart = zoomedMemorySize[0] || 0;
    const zoomedMemorySizeEnd = zoomedMemorySize[1] || memorySize;
    const memoryPadding = (zoomedMemorySizeEnd - zoomedMemorySizeStart) * MEMORY_ZOOM_PADDING_RATIO;

    const tensorList = useMemo(
        () => createHistoricalTensorList(operationsList, buffersByOperation),
        [operationsList, buffersByOperation],
    );

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

    return buffersByOperation && !isLoadingBuffers && !isLoadingOperations && !isLoadingDevices && tensorList ? (
        <div className='buffer-summary-chart'>
            <Switch
                label='Buffer zoom'
                checked={isZoomedIn}
                onChange={() => {
                    setIsZoomedIn(!isZoomedIn);
                }}
            />

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
                                >
                                    <BufferSummaryRow
                                        buffers={operation.buffers}
                                        operationId={operation.id}
                                        memoryStart={isZoomedIn ? zoomedMemorySizeStart : 0}
                                        memoryEnd={isZoomedIn ? zoomedMemorySizeEnd : memorySize}
                                        memoryPadding={memoryPadding}
                                    />

                                    <p className='y-axis-tick'>{operation.id}</p>
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

// Modified from 'createHitoricalTensorList' function in OperationDetails.ts
// TODO: Refactor to optimise historical tensor lookup
function createHistoricalTensorList(operations?: Operation[], buffersByOperation?: BuffersByOperationData[]) {
    const tensorsByBufferAddress: Map<number, HistoricalTensor> = new Map();

    if (!operations || !buffersByOperation) {
        return tensorsByBufferAddress;
    }

    buffersByOperation.forEach((operation) => {
        const currentOperation = operations.find((op) => op.id === operation.id);

        // eslint-disable-next-line no-restricted-syntax
        for (const buffer of operation.buffers) {
            const bufferAddress = buffer.address;
            const bufferType = buffer.buffer_type;
            let opId: number | undefined;
            let tensor: Tensor | undefined;

            for (let i = operations.indexOf(currentOperation!); i >= 0; i--) {
                const op = operations[i];
                opId = op.id;

                tensor = op.inputs.find((input) => input.address === bufferAddress);

                if (tensor !== undefined) {
                    break;
                }

                tensor = op.outputs.find((output) => output.address === bufferAddress);

                if (tensor !== undefined) {
                    break;
                }
            }

            if (tensor !== undefined) {
                const historicalTensor: HistoricalTensor = {
                    ...tensor,
                    parentOperationId: opId!,
                    historical: opId! !== operation.id,
                    buffer_type: bufferType,
                };
                tensorsByBufferAddress.set(bufferAddress, historicalTensor);
            }
        }
    });

    return tensorsByBufferAddress;
}

export default BufferSummaryPlotRenderer;
