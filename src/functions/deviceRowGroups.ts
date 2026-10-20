// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PerfTableRow } from '../model/PerfTable';
import { OpType } from '../definitions/Performance';

/**
 * @description Groups an unmerged report's per-device rows the way
 * `merge_device_rows` in `tt-perf-report` does, one group per merged row. The
 * merge keeps one member of each group whole, so its id is the group's only
 * link to the merged report; no column names the group (#2084).
 *
 * The merge pairs rows by position, not by any shared id: each round takes the
 * head of every device's queue, in ascending device order, and a device whose
 * head names a different op is skipped for that round rather than popped. That
 * is mirrored here line for line (`perf_report.py`, `merge_device_rows`, against
 * the `tt-perf-report` version pinned in `pyproject.toml`; re-check it when the
 * pin moves).
 *
 * The rows must be in the order the merge saw them: the whole run, sorted by
 * host start time. An unmerged report fetched with signposts unset and tracing
 * mode off is emitted in exactly that order.
 */
export const groupDeviceRowsLikeMerge = (rows: PerfTableRow[]): PerfTableRow[][] => {
    const queueByDevice = new Map<number, PerfTableRow[]>();

    for (const row of rows) {
        const device = parseInt(row.device, 10);

        // The merge passes host ops, signposts and device ops without a usable
        // device id through unmerged, so they never join a group.
        if (row.op_type === OpType.DEVICE_OP && !Number.isNaN(device)) {
            const queue = queueByDevice.get(device);

            if (queue) {
                queue.push(row);
            } else {
                queueByDevice.set(device, [row]);
            }
        }
    }

    const devices = [...queueByDevice.keys()].sort((a, b) => a - b);
    const queues = devices.map((device) => queueByDevice.get(device)!);
    // A head index per queue rather than `shift()`, which would make draining quadratic.
    const heads = queues.map(() => 0);
    const groups: PerfTableRow[][] = [];

    while (queues.some((queue, index) => heads[index] < queue.length)) {
        const group: PerfTableRow[] = [];
        let opName: string | null = null;

        queues.forEach((queue, index) => {
            if (heads[index] >= queue.length) {
                return;
            }

            const head = queue[heads[index]];

            if (opName === null) {
                opName = head.raw_op_code;
            } else if (head.raw_op_code !== opName) {
                return;
            }

            group.push(head);
            heads[index] += 1;
        });

        groups.push(group);
    }

    return groups;
};

/**
 * @description Extends a perf-id -> op-id lookup built from merged rows onto the
 * other members of each merged row's device group, so every per-device row of a
 * linked operation joins the same op.
 *
 * A group is extended only when exactly one of its members is already linked.
 * With none there is nothing to carry; with more than one the grouping has not
 * reproduced the merge, and leaving the rows unlinked is better than attributing
 * them to the wrong operation.
 */
export const getSiblingOpIds = (groups: PerfTableRow[][], opIdByPerfId: Map<string, number>): Map<string, number> => {
    const siblingOpIds = new Map<string, number>();

    for (const group of groups) {
        const linkedOpIds = group.flatMap((row) => {
            const opId = opIdByPerfId.get(row.id);
            return opId === undefined ? [] : [opId];
        });

        if (linkedOpIds.length === 1) {
            for (const row of group) {
                if (!opIdByPerfId.has(row.id)) {
                    siblingOpIds.set(row.id, linkedOpIds[0]);
                }
            }
        }
    }

    return siblingOpIds;
};
