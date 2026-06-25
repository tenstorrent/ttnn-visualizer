// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PerfTableRow, TypedPerfTableRow } from '../definitions/PerfTable';
import { HIGH_DISPATCH_THRESHOLD_MS } from '../definitions/Performance';
import { BufferType } from '../model/BufferType';
import { DeviceOperationLayoutTypes } from '../model/APIData';
import { L1PressureMetrics } from './l1Pressure';
import { parsePerfRowTensorAttributes } from './parsePerfRowTensorAttributes';

interface RowAttributes {
    buffer_type: BufferType | null;
    layout: DeviceOperationLayoutTypes | null;
}

export const getRowAttributes = (row: PerfTableRow): RowAttributes => {
    const { buffer_type: bufferType, layout } = parsePerfRowTensorAttributes(row);

    return {
        buffer_type: bufferType,
        layout,
    };
};

// Converts the raw string-based rows produced by tt-perf-report (via the backend CSV parse) into
// the typed numeric rows the performance table renders. Keep the parsing here aligned with the
// columns tt-perf-report emits so the table reflects the same data.
export const enrichRowData = (
    rows: PerfTableRow[],
    opIdsMap: { perfId?: string; opId: number }[],
    l1PressureMap: Map<number, L1PressureMetrics> | null,
): TypedPerfTableRow[] => {
    // Build the perf-id -> op-id lookup once so enrichment stays O(N) instead of O(N·M) — the
    // previous `.find()` per row scaled with both row count and the active report's op count.
    const opIdByPerfId = new Map<string, number>();
    for (const { perfId, opId } of opIdsMap) {
        if (perfId !== undefined) {
            opIdByPerfId.set(perfId, opId);
        }
    }

    const typedRows = rows.map((row) => {
        const val = parseInt(row.op_to_op_gap, 10);
        const op = opIdByPerfId.get(row.id);
        // TTNN-op snapshot is shared by all device ops that map to the same row.op.
        const l1Pressure = op !== undefined ? l1PressureMap?.get(op) : undefined;

        return {
            ...row,
            op,
            high_dispatch: !!val && val > HIGH_DISPATCH_THRESHOLD_MS,
            id: parseInt(row.id, 10),
            total_percent: parseFloat(row.total_percent),
            device: parseInt(row.device, 10) ?? null,
            device_time: parseFloat(row.device_time),
            op_to_op_gap: row.op_to_op_gap ? parseFloat(row.op_to_op_gap) : null,
            cores: parseInt(row.cores, 10),
            dram: row.dram ? parseFloat(row.dram) : null,
            dram_percent: row.dram_percent ? parseFloat(row.dram_percent) : null,
            flops: row.flops ? parseFloat(row.flops) : null,
            flops_percent: row.flops_percent ? parseFloat(row.flops_percent) : null,
            pm_ideal_ns: row.pm_ideal_ns ? parseFloat(row.pm_ideal_ns) : null,
            l1_fullness_percent: l1Pressure?.fullnessPercent ?? null,
            l1_free_segments: l1Pressure?.freeSegments ?? null,
            l1_largest_free: l1Pressure?.largestFreeBytes ?? null,
            l1_largest_free_percent: l1Pressure?.largestFreePercent ?? null,
            ...getRowAttributes(row),
            isFirstHashOccurrence: true, // Default to true, will be updated if needed in next step
        };
    });

    // Mark which rows are the first occurrence of each hash
    const hashFirstOccurrence = new Map<string | null, boolean>();
    for (const row of typedRows) {
        if (row.hash && !hashFirstOccurrence.has(row.hash)) {
            hashFirstOccurrence.set(row.hash, true);
            row.isFirstHashOccurrence = true;
        } else if (row.hash) {
            row.isFirstHashOccurrence = false;
        }
    }

    return typedRows;
};
