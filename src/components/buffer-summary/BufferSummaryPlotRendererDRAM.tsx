// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { BufferSummaryAxisConfiguration } from '../../definitions/PlotConfigurations';
import LoadingSpinner from '../LoadingSpinner';
import ROUTES from '../../definitions/Routes';
import { renderMemoryLayoutAtom, showBufferSummaryZoomedAtom } from '../../store/app';
import { DRAM_MEMORY_SIZE } from '../../definitions/DRAMMemorySize';
import { ScrollLocations } from '../../definitions/VirtualLists';
import { BuffersByOperation } from '../../model/APIData';
import { TensorsByOperationByAddress } from '../../model/BufferSummary';
import { MEMORY_ZOOM_PADDING_RATIO } from '../../definitions/BufferSummary';
import BufferSummaryVirtualizedList from './BufferSummaryVirtualizedList';

const MEMORY_SIZE = DRAM_MEMORY_SIZE;

interface BufferSummaryPlotRendererDRAMProps {
    uniqueBuffersByOperationList: BuffersByOperation[];
    tensorListByOperation: TensorsByOperationByAddress;
}

function BufferSummaryPlotRendererDRAM({
    uniqueBuffersByOperationList,
    tensorListByOperation,
}: BufferSummaryPlotRendererDRAMProps) {
    const isZoomedIn = useAtomValue(showBufferSummaryZoomedAtom);
    const showMemoryLayout = useAtomValue(renderMemoryLayoutAtom);

    const segmentedChartData: BuffersByOperation[][] = useMemo(() => {
        if (isZoomedIn) {
            return getSplitBuffers(uniqueBuffersByOperationList);
        }

        return [uniqueBuffersByOperationList];
    }, [uniqueBuffersByOperationList, isZoomedIn]);

    const zoomedMemoryOptions = useMemo(
        () =>
            segmentedChartData
                .map((segment) => {
                    if (segment.length > 1) {
                        const buffers = segment.flatMap((op) => op.buffers);
                        const zoomStart = buffers[0].address;
                        const zoomEnd = buffers[buffers.length - 1].address + buffers[buffers.length - 1].size;

                        return {
                            start: zoomStart,
                            end: zoomEnd,
                            padding: (zoomEnd - zoomStart) * MEMORY_ZOOM_PADDING_RATIO,
                        };
                    }
                    return null;
                })
                .filter((elt) => elt !== null),
        [segmentedChartData],
    );

    return uniqueBuffersByOperationList && tensorListByOperation ? (
        <BufferSummaryVirtualizedList
            operations={segmentedChartData[0] || []}
            tensorListByOperation={tensorListByOperation}
            isZoomedIn={isZoomedIn}
            showMemoryLayout={showMemoryLayout}
            scrollLocation={ScrollLocations.BUFFER_SUMMARY_DRAM}
            memorySize={MEMORY_SIZE}
            zoomStart={zoomedMemoryOptions[0]?.start ?? 0}
            zoomEnd={zoomedMemoryOptions[0]?.end ?? MEMORY_SIZE}
            memoryPadding={zoomedMemoryOptions[0]?.padding ?? 0}
            axisConfiguration={BufferSummaryAxisConfiguration}
            getOperationTooltipContent={(operation) => `${operation.id} ${operation.name}`}
            renderOperationLink={(operation) => (
                <Link to={`${ROUTES.OPERATIONS}/${operation.id}`}>
                    {operation.id}&nbsp;{operation.name}
                </Link>
            )}
        />
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
