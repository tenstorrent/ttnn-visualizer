// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from '../../store/app';
import { L1_DEFAULT_MEMORY_SIZE } from '../../definitions/L1MemorySize';
import { ScrollLocations } from '../../definitions/VirtualLists';
import { BuffersByOperation, MarkerTypeLabel } from '../../model/APIData';
import { DEFAULT_DEVICE_ID } from '../../definitions/Devices';
import { TensorDeallocationReport, TensorsByOperationByAddress } from '../../model/BufferSummary';
import { MEMORY_ZOOM_PADDING_RATIO } from '../../definitions/BufferSummary';
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
    const renderMemoryLayout = useAtomValue(renderMemoryLayoutAtom);
    const isZoomedIn = useAtomValue(showBufferSummaryZoomedAtom);
    const showMemoryRegions = useAtomValue(showMemoryRegionsAtom);

    const { data: devices, isLoading: isLoadingDevices } = useDevices();
    const { data: operations } = useOperationsList();
    const navigate = useNavigate();
    const l1StartMarker = useGetL1StartMarker();
    const l1SmallMarker = useGetL1SmallMarker();

    const { lateDeallocationsByOperation: nonDeallocatedTensorsByOperationId } =
        useGetTensorDeallocationReportByOperation();

    const memorySize = useMemo(
        () => (!isLoadingDevices && devices ? devices[DEFAULT_DEVICE_ID]?.worker_l1_size : L1_DEFAULT_MEMORY_SIZE),
        [devices, isLoadingDevices],
    );

    const zoomedMemorySize = useMemo(() => {
        const addresses = uniqueBuffersByOperationList.flatMap((operation) =>
            operation.buffers.flatMap((buffer) => [buffer.address, buffer.address + buffer.size]),
        );

        if (addresses.length === 0) {
            return [0, memorySize];
        }

        return [Math.min(...addresses), Math.max(...addresses)];
    }, [uniqueBuffersByOperationList, memorySize]);

    const memoryRegionsMarkers = showMemoryRegions
        ? [
              { color: L1_SMALL_MARKER_COLOR, address: l1SmallMarker, label: MarkerTypeLabel.L1_SMALL },
              { color: L1_START_MARKER_COLOR, address: l1StartMarker, label: MarkerTypeLabel.L1_START },
          ]
        : [];
    const zoomedMemorySizeStart = zoomedMemorySize[0] || 0;
    const zoomedMemorySizeEnd = zoomedMemorySize[1] || memorySize;
    const memoryPadding = (zoomedMemorySizeEnd - zoomedMemorySizeStart) * MEMORY_ZOOM_PADDING_RATIO;

    const handleNavigateToOperation = (event: React.MouseEvent<HTMLAnchorElement>, path: string) => {
        event.preventDefault();
        navigate(path);
    };

    return uniqueBuffersByOperationList && !isLoadingDevices && tensorListByOperation ? (
        <BufferSummaryVirtualizedList
            operations={uniqueBuffersByOperationList}
            tensorListByOperation={tensorListByOperation}
            isZoomedIn={isZoomedIn}
            showMemoryLayout={renderMemoryLayout}
            scrollLocation={ScrollLocations.BUFFER_SUMMARY}
            memorySize={memorySize}
            zoomStart={zoomedMemorySizeStart}
            zoomEnd={zoomedMemorySizeEnd}
            memoryPadding={memoryPadding}
            axisConfiguration={BufferSummaryAxisConfiguration}
            markers={memoryRegionsMarkers}
            getTensorDeallocationReport={(operationId) =>
                showDeallocationReport
                    ? nonDeallocatedTensorsByOperationId.get(operationId) || EMPTY_TENSOR_DEALLOCATION_REPORT
                    : EMPTY_TENSOR_DEALLOCATION_REPORT
            }
            getOperationTooltipContent={(operation) =>
                `${operation.id} ${operation.name} (${operations?.find((op) => op.id === operation.id)?.operationFileIdentifier})`
            }
            renderOperationLink={(operation) => (
                <a
                    href={`${ROUTES.OPERATIONS}/${operation.id}`}
                    onClick={(event) => handleNavigateToOperation(event, `${ROUTES.OPERATIONS}/${operation.id}`)}
                >
                    {operation.id}&nbsp;{operation.name}
                </a>
            )}
        />
    ) : (
        <LoadingSpinner />
    );
}

export default BufferSummaryPlotRenderer;
