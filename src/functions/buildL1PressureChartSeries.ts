// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { TypedPerfTableRow } from '../definitions/PerfTable';

export interface L1PressureChartSeries {
    x: number[];
    fullnessPercent: (number | null)[];
    largestFreePercent: (number | null)[];
    opCodes: string[];
}

/** One L1 sample per TTNN op run (first device-op row in each consecutive `op` group). */
export function buildL1PressureChartSeries(rows: TypedPerfTableRow[]): L1PressureChartSeries {
    const x: number[] = [];
    const fullnessPercent: (number | null)[] = [];
    const largestFreePercent: (number | null)[] = [];
    const opCodes: string[] = [];

    let previousOp: number | undefined;

    rows.forEach((row, index) => {
        const isFirstOfOpRun = row.op !== previousOp;
        previousOp = row.op;

        x.push(index + 1);
        opCodes.push(row.op_code ?? '');

        if (!isFirstOfOpRun) {
            fullnessPercent.push(null);
            largestFreePercent.push(null);
            return;
        }

        fullnessPercent.push(row.l1_fullness_percent);
        largestFreePercent.push(row.l1_largest_free_percent);
    });

    return { x, fullnessPercent, largestFreePercent, opCodes };
}
