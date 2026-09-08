// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PerfTableRow } from './PerfTable';

/**
 * One device operation from the memory report, optionally paired with the
 * performance-report row it was matched to.
 */
export interface DeviceOperationMapping {
    name: string;
    id: number;
    operationName: string;
    perfData?: PerfTableRow;
}
