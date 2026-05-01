// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useMemo } from 'react';
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
import { MAX_DRAM_BUFFERS_FOR_GAP_SPLIT, MEMORY_ZOOM_PADDING_RATIO } from '../../definitions/BufferSummary';
import BufferSummaryVirtualizedList from './BufferSummaryVirtualizedList';

const MEMORY_SIZE = DRAM_MEMORY_SIZE;
const SPLIT_THRESHOLD_RATIO = 2;

type FlattenedBuffer = {
    address: number;
    size: number;
    opId: number;
    opName: string;
    buffer: BuffersByOperation['buffers'][number];
};

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
        if (!isZoomedIn) {
            return [uniqueBuffersByOperationList];
        }

        const totalBuffers = countBuffersAcrossOperations(uniqueBuffersByOperationList);

        if (totalBuffers > MAX_DRAM_BUFFERS_FOR_GAP_SPLIT) {
            return [uniqueBuffersByOperationList];
        }

        return getSplitBuffers(uniqueBuffersByOperationList);
    }, [uniqueBuffersByOperationList, isZoomedIn]);

    const zoomedMemoryOption = useMemo(() => {
        const segment = segmentedChartData.find((segmentedOperations) => segmentedOperations.length > 1);

        if (!segment) {
            return null;
        }

        const firstBuffer = segment[0]?.buffers[0];
        const lastOperationBuffers = segment[segment.length - 1]?.buffers;
        const lastBuffer = lastOperationBuffers?.[lastOperationBuffers.length - 1];

        if (!firstBuffer || !lastBuffer) {
            return null;
        }

        const zoomStart = firstBuffer.address;
        const zoomEnd = lastBuffer.address + lastBuffer.size;

        return {
            start: zoomStart,
            end: zoomEnd,
            padding: (zoomEnd - zoomStart) * MEMORY_ZOOM_PADDING_RATIO,
        };
    }, [segmentedChartData]);
    const getOperationTooltipContent = useCallback(
        (operation: BuffersByOperation) => `${operation.id} ${operation.name}`,
        [],
    );
    const renderOperationLink = useCallback(
        (operation: BuffersByOperation) => (
            <Link to={`${ROUTES.OPERATIONS}/${operation.id}`}>
                {operation.id}&nbsp;{operation.name}
            </Link>
        ),
        [],
    );

    return uniqueBuffersByOperationList && tensorListByOperation ? (
        <BufferSummaryVirtualizedList
            operations={segmentedChartData[0] || []}
            tensorListByOperation={tensorListByOperation}
            isZoomedIn={isZoomedIn}
            showMemoryLayout={showMemoryLayout}
            scrollLocation={ScrollLocations.BUFFER_SUMMARY_DRAM}
            memorySize={MEMORY_SIZE}
            zoomStart={zoomedMemoryOption?.start ?? 0}
            zoomEnd={zoomedMemoryOption?.end ?? MEMORY_SIZE}
            memoryPadding={zoomedMemoryOption?.padding ?? 0}
            axisConfiguration={BufferSummaryAxisConfiguration}
            getOperationTooltipContent={getOperationTooltipContent}
            renderOperationLink={renderOperationLink}
        />
    ) : (
        <LoadingSpinner />
    );
}

function countBuffersAcrossOperations(operations: BuffersByOperation[]): number {
    let count = 0;
    for (const op of operations) {
        count += op.buffers.length;
    }
    return count;
}

function getSplitBuffers(data: BuffersByOperation[]): BuffersByOperation[][] {
    const buffers: FlattenedBuffer[] = [];

    data.forEach((operation) => {
        operation.buffers.forEach((buffer) => {
            buffers.push({
                address: buffer.address,
                size: buffer.size,
                opId: operation.id,
                opName: operation.name,
                buffer,
            });
        });
    });

    buffers.sort((a, b) => a.address - b.address);

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

        buffersGroup.forEach((entry) => {
            if (!operationsMap.has(entry.opId)) {
                operationsMap.set(entry.opId, { id: entry.opId, name: entry.opName, buffers: [] });
            }
            operationsMap.get(entry.opId)!.buffers.push(entry.buffer);
        });

        return Array.from(operationsMap.values());
    });
}

export default BufferSummaryPlotRendererDRAM;
