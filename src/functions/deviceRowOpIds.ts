// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PerfTableRow } from '../model/PerfTable';

/**
 * @description Extends a perf-id -> op-id lookup built from merged rows onto the
 * per-device rows each merged row stands for, so every device's row of a linked
 * operation joins the same op (#2084).
 *
 * The members are `device_row_ids`, which the backend reads from tt-perf-report's
 * own `merge_device_rows` (#2177), so a merged row's own id is the only one of
 * them that can already be linked. A row without the field adds nothing, which
 * leaves its siblings unlinked rather than guessed.
 */
export const getDeviceRowOpIds = (
    mergedRows: PerfTableRow[],
    opIdByPerfId: Map<string, number>,
): Map<string, number> => {
    const opIdByDeviceRowId = new Map<string, number>();

    for (const row of mergedRows) {
        const opId = opIdByPerfId.get(row.id);

        if (opId !== undefined) {
            for (const member of row.device_row_ids ?? []) {
                // Ids are integers on the wire but strings on the row, as `id` is.
                const memberId = String(member);

                if (!opIdByPerfId.has(memberId)) {
                    opIdByDeviceRowId.set(memberId, opId);
                }
            }
        }
    }

    return opIdByDeviceRowId;
};
