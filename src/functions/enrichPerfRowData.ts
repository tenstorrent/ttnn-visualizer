// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { LinkedOperationData, PerfTableRow, TypedPerfTableRow } from '../model/PerfTable';
import { BoundAnalysis } from '../definitions/PerfTable';
import { OperationCategories } from '../definitions/StackedPerfTable';
import { HIGH_DISPATCH_THRESHOLD_US } from '../definitions/Performance';
import { BufferType } from '../model/BufferType';
import { DeviceOperationLayoutTypes } from '../model/APIData';
import { nsToUs } from './math';
import { parsePerfRowTensorAttributes } from './parsePerfRowTensorAttributes';
import { isFlagEnabled } from './getServerConfig';

interface RowAttributes {
    buffer_type: BufferType | null;
    layout: DeviceOperationLayoutTypes | null;
}

const parseNullableInteger = (value: string | null | undefined): number | null => {
    if (value == null || value === '') {
        return null;
    }

    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
};

// Narrows a CSV string to a member of a string enum, so an unrecognised value from a newer
// tt-perf-report reads as unknown rather than being trusted as a known member.
const parseEnumValue = <T extends string>(values: readonly T[], value: string | null | undefined): T | null =>
    values.find((member) => member === value) ?? null;

const BOUND_ANALYSIS_VALUES = Object.values(BoundAnalysis);
const OPERATION_CATEGORY_VALUES = Object.values(OperationCategories);

export const getRowAttributes = (row: PerfTableRow): RowAttributes => {
    const { buffer_type: bufferType, layout } = parsePerfRowTensorAttributes(row);

    return {
        buffer_type: bufferType,
        layout,
    };
};

const getLinkedValue = <T>(valueByOpId: Map<number, T> | null | undefined, op: number | undefined): T | null =>
    (op !== undefined ? valueByOpId?.get(op) : undefined) ?? null;

// Converts the raw string-based rows produced by tt-perf-report (via the backend CSV parse) into
// the typed numeric rows the performance table renders. Keep the parsing here aligned with the
// columns tt-perf-report emits so the table reflects the same data.
export const enrichRowData = (
    rows: PerfTableRow[],
    opIdsMap: { perfId?: string; opId: number }[],
    linkedOperationData: LinkedOperationData | null,
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
        const op = opIdByPerfId.get(row.id);
        // TTNN-op snapshot is shared by all device ops that map to the same row.op.
        const l1Pressure = getLinkedValue(linkedOperationData?.l1PressureByOpId, op);
        // Parse the gap as a float once and reuse it for both the value and the high-dispatch flag.
        // parseInt would truncate (e.g. "6.6" -> 6), wrongly clearing the > 6.5µs flag.
        const parsedGap = parseFloat(row.op_to_op_gap);
        const opToOpGap = Number.isNaN(parsedGap) ? null : parsedGap;
        // parseInt yields NaN (not nullish) for missing values, so collapse it to null explicitly
        // rather than leaking NaN into a `number | null` field.
        const parsedDevice = parseInt(row.device, 10);

        return {
            ...row,
            op,
            high_dispatch: opToOpGap !== null && opToOpGap > HIGH_DISPATCH_THRESHOLD_US,
            id: parseInt(row.id, 10),
            total_percent: parseFloat(row.total_percent),
            device: Number.isNaN(parsedDevice) ? null : parsedDevice,
            device_time: parseFloat(row.device_time),
            op_to_op_gap: opToOpGap,
            cores: parseInt(row.cores, 10),
            available_cores: parseNullableInteger(row.available_cores),
            op_category: parseEnumValue(OPERATION_CATEGORY_VALUES, row.op_category),
            bound_analysis: parseEnumValue(BOUND_ANALYSIS_VALUES, row.bound_analysis),
            dram: row.dram ? parseFloat(row.dram) : null,
            dram_percent: row.dram_percent ? parseFloat(row.dram_percent) : null,
            flops: row.flops ? parseFloat(row.flops) : null,
            flops_percent: row.flops_percent ? parseFloat(row.flops_percent) : null,
            dram_sharded: isFlagEnabled(row.dram_sharded),
            pm_ideal_ns: row.pm_ideal_ns ? parseFloat(row.pm_ideal_ns) : null,
            // Kernel durations arrive as raw nanosecond strings (CSV `[ns]` columns); convert to µs
            // to match the table's `unit: 'µs'` column declarations. nsToUs handles the nullish case.
            device_kernel_duration: nsToUs(row.device_kernel_duration),
            brisc_kernel_duration: nsToUs(row.brisc_kernel_duration),
            ncrisc_kernel_duration: nsToUs(row.ncrisc_kernel_duration),
            trisc0_kernel_duration: nsToUs(row.trisc0_kernel_duration),
            trisc1_kernel_duration: nsToUs(row.trisc1_kernel_duration),
            trisc2_kernel_duration: nsToUs(row.trisc2_kernel_duration),
            erisc_kernel_duration: nsToUs(row.erisc_kernel_duration),
            l1_fullness_percent: l1Pressure?.fullnessPercent ?? null,
            l1_free_segments: l1Pressure?.freeSegments ?? null,
            l1_largest_free: l1Pressure?.largestFreeBytes ?? null,
            l1_largest_free_percent: l1Pressure?.largestFreePercent ?? null,
            allocation_failure: getLinkedValue(linkedOperationData?.allocationFailureByOpId, op),
            dram_fallback: getLinkedValue(linkedOperationData?.dramFallbackByOpId, op),
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
