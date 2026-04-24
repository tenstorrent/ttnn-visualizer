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
    plotZoomRangeStart: number;
    plotZoomRangeEnd: number;
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
    const canUserSetRange = zoomRange?.operationKey === currentOperationKey;

    const { plotZoomRangeStart, plotZoomRangeEnd } = useMemo(() => {
        let nextPlotZoomRangeStart = memory[0]?.address || memorySizeL1;
        let nextPlotZoomRangeEnd =
            memory.length > 0 ? memory[memory.length - 1].address + memory[memory.length - 1].size : 0;

        if (nextPlotZoomRangeEnd < nextPlotZoomRangeStart) {
            nextPlotZoomRangeStart = 0;
            nextPlotZoomRangeEnd = memorySizeL1;
        }

        return {
            plotZoomRangeStart: nextPlotZoomRangeStart,
            plotZoomRangeEnd: nextPlotZoomRangeEnd,
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
        plotZoomRangeStart,
        plotZoomRangeEnd,
        zoomRangeStart: canUserSetRange ? zoomRange?.start : plotZoomRangeStart,
        zoomRangeEnd: canUserSetRange ? zoomRange?.end : plotZoomRangeEnd,
        handleSetZoomRange,
    };
};

export default useL1ZoomRange;
