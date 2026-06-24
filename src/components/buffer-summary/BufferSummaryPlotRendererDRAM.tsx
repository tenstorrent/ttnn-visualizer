// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { BufferSummaryAxisConfiguration } from '../../definitions/PlotConfigurations';
import LoadingSpinner from '../LoadingSpinner';
import ROUTES from '../../definitions/Routes';
import { renderMemoryLayoutAtom, showBufferSummaryZoomedAtom, topNAnnotationModeAtom } from '../../store/app';
import { DRAM_MEMORY_SIZE } from '../../definitions/DRAMMemorySize';
import { ScrollLocations } from '../../definitions/VirtualLists';
import { BuffersByOperation } from '../../model/APIData';
import { TensorsByOperationByAddress } from '../../model/BufferSummary';
import { MAX_DRAM_BUFFERS_FOR_GAP_SPLIT, MEMORY_ZOOM_PADDING_RATIO } from '../../definitions/BufferSummary';
import {
    countBuffersAcrossOperations,
    getBufferAddressBounds,
    getSplitBuffers,
    memoryZoomPaddingForRange,
} from '../../functions/bufferSummary';
import { useTopNAnnotations } from '../../hooks/useTopNAnnotations';
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

    const segmentedChartData = useMemo(() => {
        if (!isZoomedIn) {
            return [uniqueBuffersByOperationList];
        }

        const totalBuffers = countBuffersAcrossOperations(uniqueBuffersByOperationList);

        if (totalBuffers > MAX_DRAM_BUFFERS_FOR_GAP_SPLIT) {
            // eslint-disable-next-line no-console
            console.warn(`Total buffers (${totalBuffers}) exceed the maximum threshold, rendering without splitting.`);
            return [uniqueBuffersByOperationList];
        }

        const splitSegments = getSplitBuffers(uniqueBuffersByOperationList);

        return splitSegments;
    }, [isZoomedIn, uniqueBuffersByOperationList]);

    const multiOpZoomSegment = useMemo(() => {
        if (!isZoomedIn) {
            return null;
        }

        return segmentedChartData.find((segmentedOperations) => segmentedOperations.length > 1) ?? null;
    }, [isZoomedIn, segmentedChartData]);

    const shouldApplyZoom = Boolean(multiOpZoomSegment);

    const operationsForList = useMemo(() => {
        if (!isZoomedIn) {
            return segmentedChartData[0] ?? [];
        }

        if (multiOpZoomSegment) {
            return multiOpZoomSegment;
        }

        return uniqueBuffersByOperationList;
    }, [isZoomedIn, segmentedChartData, multiOpZoomSegment, uniqueBuffersByOperationList]);

    const zoomedMemoryOption = useMemo(() => {
        if (!shouldApplyZoom || !operationsForList.length) {
            return null;
        }

        const bounds = getBufferAddressBounds(operationsForList);
        if (!bounds) {
            return null;
        }

        return {
            start: bounds.start,
            end: bounds.end,
            padding: memoryZoomPaddingForRange(bounds.start, bounds.end, MEMORY_ZOOM_PADDING_RATIO),
        };
    }, [operationsForList, shouldApplyZoom]);

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

    // DRAM tab forces L1 fullness UNAVAILABLE — fullness is computed against the L1 budget
    // and doesn't carry meaning here. Only perf-time mode produces annotations on this tab.
    const { annotationsByOpId: topNAnnotationsByOpId } = useTopNAnnotations({
        operations: operationsForList,
        forceL1Unavailable: true,
    });
    const topNAnnotationMode = useAtomValue(topNAnnotationModeAtom);

    return uniqueBuffersByOperationList && tensorListByOperation ? (
        <BufferSummaryVirtualizedList
            operations={operationsForList}
            tensorListByOperation={tensorListByOperation}
            isZoomedIn={shouldApplyZoom}
            showMemoryLayout={showMemoryLayout}
            scrollLocation={ScrollLocations.BUFFER_SUMMARY_DRAM}
            memorySize={MEMORY_SIZE}
            zoomStart={zoomedMemoryOption?.start ?? 0}
            zoomEnd={zoomedMemoryOption?.end ?? MEMORY_SIZE}
            memoryPadding={zoomedMemoryOption?.padding ?? 0}
            axisConfiguration={BufferSummaryAxisConfiguration}
            topNAnnotationsByOpId={topNAnnotationsByOpId}
            topNAnnotationMode={topNAnnotationMode}
            getOperationTooltipContent={getOperationTooltipContent}
            renderOperationLink={renderOperationLink}
        />
    ) : (
        <LoadingSpinner />
    );
}

export default BufferSummaryPlotRendererDRAM;
