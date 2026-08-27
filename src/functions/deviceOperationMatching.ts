// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PerfTableRow } from '../model/PerfTable';
import { DeviceOperationMapping } from '../model/DeviceOperationMapping';
import { OpType } from '../definitions/Performance';

/**
 * TODO: remove once memory and performance reports carry a shared run id (#1800)
 * @description Drop per-device duplicates of the same device operation, keeping
 * only keys seen exactly once per device. Some multi-device memory reports
 * record each device op once per device and others record it once, and nothing
 * in the report distinguishes the two shapes — so this is a fallback for the
 * duplicated shape rather than an unconditional normalisation. See #1810.
 */
export const collapseMultideviceOperations = (
    deviceOperations: DeviceOperationMapping[],
    numDevices: number,
): DeviceOperationMapping[] => {
    // A single device has no per-device duplicates, and an unknown device count
    // (0, before the devices query settles) gives no count to collapse on.
    if (numDevices <= 1) {
        return deviceOperations;
    }

    const operationCountByKey = new Map<string, number>();

    for (const { name, id } of deviceOperations) {
        const key = `${name}-${id}`;
        operationCountByKey.set(key, (operationCountByKey.get(key) || 0) + 1);
    }

    const collapsed: DeviceOperationMapping[] = [];
    const seen = new Set<string>();

    for (const deviceOperation of deviceOperations) {
        const key = `${deviceOperation.name}-${deviceOperation.id}`;

        if (!seen.has(key) && operationCountByKey.get(key) === numDevices) {
            collapsed.push(deviceOperation);
            seen.add(key);
        }
    }

    return collapsed;
};

/**
 * @description Pair each device operation with the perf row at the same index,
 * or return [] if any position disagrees. Trailing perf rows are tolerated so a
 * report that also lists host ops still matches. Validation runs before any
 * allocation because callers try more than one candidate list, and the mappings
 * are copies so a rejected attempt leaves the caller's list untouched.
 */
const alignToPerfRows = (
    deviceOperations: DeviceOperationMapping[],
    perfRows: PerfTableRow[],
): DeviceOperationMapping[] => {
    if (deviceOperations.length === 0 || deviceOperations.length > perfRows.length) {
        return [];
    }

    const isAligned = deviceOperations.every(
        (deviceOperation, index) => perfRows[index].raw_op_code === deviceOperation.name,
    );

    if (!isAligned) {
        return [];
    }

    return deviceOperations.map((deviceOperation, index) => ({ ...deviceOperation, perfData: perfRows[index] }));
};

/**
 * @description Drop the signpost rows a model emits with `signpost()`. They are
 * markers rather than operations, so the memory report has no device operation
 * to pair them with, and they are their own op type rather than a host op — so
 * the pinned `hideHostOps` filter leaves them in place. Alignment is positional,
 * so one signpost anywhere but the tail shifts every later row out of position
 * and fails the whole report. See #1943.
 */
const alignableRowsOf = (perfRows: PerfTableRow[]): PerfTableRow[] =>
    perfRows.filter((perfRow) => perfRow.op_type !== OpType.SIGNPOST);

/**
 * @description Match a memory report's device operations against a performance
 * report's rows, returning the mappings when the two sequences describe the same
 * run and [] when they don't (the report-link UNLINKED signal).
 *
 * The raw list is tried first because it is the shape most reports have; only
 * when that fails do we assume the memory report duplicated each op per device
 * and retry against the collapsed list.
 */
export const matchDeviceOperationsToPerf = (
    deviceOperations: DeviceOperationMapping[],
    perfRows: PerfTableRow[],
    numDevices: number,
): DeviceOperationMapping[] => {
    const alignableRows = alignableRowsOf(perfRows);
    const directMatch = alignToPerfRows(deviceOperations, alignableRows);

    if (directMatch.length > 0) {
        return directMatch;
    }

    // With nothing to collapse on, the fallback would repeat the pass that just
    // failed.
    if (numDevices <= 1) {
        return [];
    }

    return alignToPerfRows(collapseMultideviceOperations(deviceOperations, numDevices), alignableRows);
};
