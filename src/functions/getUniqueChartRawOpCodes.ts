// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { TypedPerfTableRow } from '../definitions/PerfTable';

/** Unique non-null raw op codes for chart traces — matches table filter null handling. */
export function getUniqueChartRawOpCodes(rows: TypedPerfTableRow[]): string[] {
    const opCodes = new Set<string>();

    for (const row of rows) {
        const { raw_op_code: rawOpCode } = row;
        if (rawOpCode != null && rawOpCode !== '') {
            opCodes.add(rawOpCode);
        }
    }

    return [...opCodes];
}
