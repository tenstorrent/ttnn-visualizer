// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useState } from 'react';

interface MemoryChunk {
    address: number;
    size: number;
}

interface UseZoomRangeProps {
    operationId: number;
    memorySizeL1: number;
    memory: MemoryChunk[];
}

interface UseZoomRange {
    plotZoomRangeMin: number;
    plotZoomRangeMax: number;
    zoomRangeStart: number;
    zoomRangeEnd: number;
    handleSetZoomRange: (start: number, end: number) => void;
}

interface ZoomRange {
    operationKey: symbol;
    start: number;
    end: number;
}

const useL1ZoomRange = ({ operationId, memorySizeL1, memory }: UseZoomRangeProps): UseZoomRange => {
    const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null);
    const currentOperationKey = useMemo(() => Symbol(String(operationId)), [operationId]);
    const isCurrentOperation = zoomRange?.operationKey === currentOperationKey;

    const { plotZoomRangeMin, plotZoomRangeMax } = useMemo(() => {
        let updatedPlotZoomRangeMin = memory[0]?.address || memorySizeL1;
        let updatedPlotZoomRangeMax =
            memory.length > 0 ? memory[memory.length - 1].address + memory[memory.length - 1].size : 0;

        if (updatedPlotZoomRangeMax < updatedPlotZoomRangeMin) {
            updatedPlotZoomRangeMin = 0;
            updatedPlotZoomRangeMax = memorySizeL1;
        }

        return {
            plotZoomRangeMin: updatedPlotZoomRangeMin,
            plotZoomRangeMax: updatedPlotZoomRangeMax,
        };
    }, [memory, memorySizeL1]);

    const handleSetZoomRange = (start: number, end: number) => {
        setZoomRange({
            operationKey: currentOperationKey,
            start,
            end,
        });
    };

    return {
        plotZoomRangeMin,
        plotZoomRangeMax,
        zoomRangeStart: isCurrentOperation ? zoomRange?.start : plotZoomRangeMin,
        zoomRangeEnd: isCurrentOperation ? zoomRange?.end : plotZoomRangeMax,
        handleSetZoomRange,
    };
};

export default useL1ZoomRange;
