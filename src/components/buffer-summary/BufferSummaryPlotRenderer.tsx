// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAtomValue } from 'jotai';
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
import LoadingSpinner from '../LoadingSpinner';
import ROUTES from '../../definitions/Routes';
import {
    renderMemoryLayoutAtom,
    showBufferSummaryZoomedAtom,
    showDeallocationReportAtom,
    showMemoryRegionsAtom,
    topNAnnotationModeAtom,
} from '../../store/app';
import { L1_DEFAULT_MEMORY_SIZE } from '../../definitions/L1MemorySize';
import { ScrollLocations } from '../../definitions/VirtualLists';
import { BuffersByOperation, MarkerTypeLabel } from '../../model/APIData';
import { DEFAULT_DEVICE_ID } from '../../definitions/Devices';
import { TensorDeallocationReport, TensorsByOperationByAddress } from '../../model/BufferSummary';
import { MEMORY_ZOOM_PADDING_RATIO } from '../../definitions/BufferSummary';
import { getBufferAddressZoomRange, memoryZoomPaddingForRange } from '../../functions/bufferSummary';
import { useTopNAnnotations } from '../../hooks/useTopNAnnotations';
import BufferSummaryVirtualizedList from './BufferSummaryVirtualizedList';

const EMPTY_TENSOR_DEALLOCATION_REPORT: TensorDeallocationReport[] = [];

interface BufferSummaryPlotRendererProps {
    uniqueBuffersByOperationList: BuffersByOperation[];
    tensorListByOperation: TensorsByOperationByAddress;
}

function BufferSummaryPlotRenderer({
    uniqueBuffersByOperationList,
    tensorListByOperation,
}: BufferSummaryPlotRendererProps) {
    const showDeallocationReport = useAtomValue(showDeallocationReportAtom);
    const showMemoryLayout = useAtomValue(renderMemoryLayoutAtom);
    const isZoomedIn = useAtomValue(showBufferSummaryZoomedAtom);
    const showMemoryRegions = useAtomValue(showMemoryRegionsAtom);

    const { data: devices, isLoading: isLoadingDevices } = useDevices();
    const { data: operations } = useOperationsList();
    const l1StartMarker = useGetL1StartMarker();
    const l1SmallMarker = useGetL1SmallMarker();

    const { lateDeallocationsByOperation: nonDeallocatedTensorsByOperationId } =
        useGetTensorDeallocationReportByOperation();

    const memorySize = useMemo(
        () => (!isLoadingDevices && devices ? devices[DEFAULT_DEVICE_ID]?.worker_l1_size : L1_DEFAULT_MEMORY_SIZE),
        [devices, isLoadingDevices],
    );

    const [zoomedMemorySizeStart, zoomedMemorySizeEnd] = useMemo(
        () => getBufferAddressZoomRange(uniqueBuffersByOperationList, memorySize),
        [uniqueBuffersByOperationList, memorySize],
    );

    const operationFileIdentifierById = useMemo(
        () => new Map(operations?.map((operation) => [operation.id, operation.operationFileIdentifier]) ?? []),
        [operations],
    );
    const memoryRegionsMarkers = useMemo(
        () =>
            showMemoryRegions
                ? [
                      { color: L1_SMALL_MARKER_COLOR, address: l1SmallMarker, label: MarkerTypeLabel.L1_SMALL },
                      { color: L1_START_MARKER_COLOR, address: l1StartMarker, label: MarkerTypeLabel.L1_START },
                  ]
                : [],
        [showMemoryRegions, l1SmallMarker, l1StartMarker],
    );
    const memoryPadding = useMemo(
        () => memoryZoomPaddingForRange(zoomedMemorySizeStart, zoomedMemorySizeEnd, MEMORY_ZOOM_PADDING_RATIO),
        [zoomedMemorySizeStart, zoomedMemorySizeEnd],
    );

    const getTensorDeallocationReport = useCallback(
        (operationId: number) =>
            showDeallocationReport
                ? nonDeallocatedTensorsByOperationId.get(operationId) || EMPTY_TENSOR_DEALLOCATION_REPORT
                : EMPTY_TENSOR_DEALLOCATION_REPORT,
        [showDeallocationReport, nonDeallocatedTensorsByOperationId],
    );

    const getOperationTooltipContent = useCallback(
        (operation: BuffersByOperation) =>
            `${operation.id} ${operation.name} (${operationFileIdentifierById.get(operation.id)})`,
        [operationFileIdentifierById],
    );

    const renderOperationLink = useCallback(
        (operation: BuffersByOperation) => (
            <Link to={`${ROUTES.OPERATIONS}/${operation.id}`}>
                {operation.id}&nbsp;{operation.name}
            </Link>
        ),
        [],
    );

    const { annotationsByOpId: topNAnnotationsByOpId } = useTopNAnnotations({
        operations: uniqueBuffersByOperationList,
    });
    const topNAnnotationMode = useAtomValue(topNAnnotationModeAtom);

    return uniqueBuffersByOperationList && !isLoadingDevices && tensorListByOperation ? (
        <BufferSummaryVirtualizedList
            operations={uniqueBuffersByOperationList}
            tensorListByOperation={tensorListByOperation}
            isZoomedIn={isZoomedIn}
            showMemoryLayout={showMemoryLayout}
            scrollLocation={ScrollLocations.BUFFER_SUMMARY}
            memorySize={memorySize}
            zoomStart={zoomedMemorySizeStart}
            zoomEnd={zoomedMemorySizeEnd}
            memoryPadding={memoryPadding}
            axisConfiguration={BufferSummaryAxisConfiguration}
            markers={memoryRegionsMarkers}
            topNAnnotationsByOpId={topNAnnotationsByOpId}
            topNAnnotationMode={topNAnnotationMode}
            getTensorDeallocationReport={getTensorDeallocationReport}
            getOperationTooltipContent={getOperationTooltipContent}
            renderOperationLink={renderOperationLink}
        />
    ) : (
        <LoadingSpinner />
    );
}

export default BufferSummaryPlotRenderer;
