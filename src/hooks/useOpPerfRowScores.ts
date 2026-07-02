// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { PerfOverlaySource, aggregatePerfByOp, scoreOps } from '../functions/perfOverlay';
import { DeviceOperationMapping, useGetDeviceOperationListPerf } from './useAPI';

export interface OpPerfRowScore {
    /** Worst-case device-kernel duration across this op's perf rows (ns). */
    deviceTimeNs: number;
    /** Log-normalised [0, 1] position driving bar width and colour. */
    t: number;
}

export interface OpPerfRowScores {
    scoreByOpId: Map<number, OpPerfRowScore>;
    isAvailable: boolean;
}

const EMPTY_RESULT: OpPerfRowScores = {
    scoreByOpId: new Map(),
    isAvailable: false,
};

// Reuses the perfOverlay scoring (#1517) so the row-bar colour ramp matches
// the graph view. #1516
export const useOpPerfRowScores = (): OpPerfRowScores => {
    const deviceOperations = useGetDeviceOperationListPerf();

    return useMemo(() => {
        if (deviceOperations.length === 0) {
            return EMPTY_RESULT;
        }
        const sources: PerfOverlaySource[] = [];
        for (const op of deviceOperations as DeviceOperationMapping[]) {
            const { perfData } = op;
            if (perfData) {
                const deviceTimeUs = parseFloat(perfData.device_time);
                if (Number.isFinite(deviceTimeUs)) {
                    sources.push({ id: op.id, device_time: deviceTimeUs });
                }
            }
        }
        if (sources.length === 0) {
            return EMPTY_RESULT;
        }
        const aggregates = aggregatePerfByOp(sources);
        if (aggregates.size === 0) {
            return EMPTY_RESULT;
        }
        const { scoreByOpId: rawScores } = scoreOps(aggregates);
        const scoreByOpId = new Map<number, OpPerfRowScore>();
        for (const [opId, aggregate] of aggregates) {
            const score = rawScores.get(opId);
            if (score) {
                scoreByOpId.set(opId, { deviceTimeNs: aggregate.deviceTimeNs, t: score.t });
            }
        }
        return {
            scoreByOpId,
            isAvailable: scoreByOpId.size > 0,
        };
    }, [deviceOperations]);
};
