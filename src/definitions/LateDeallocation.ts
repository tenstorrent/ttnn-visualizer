// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { TensorDeallocationReport } from '../model/BufferSummary';

/**
 * A row where at least one tensor *becomes* stale (#963).
 *
 * Late-deallocated tensors are reported on every row from their last use until
 * they are freed, so the rail plots only the rows where a run opens — the
 * places worth jumping to. Continuation rows are deliberately absent: dotting
 * every one of them would draw a solid bar down the gutter and bury the
 * actionable rows.
 */
export interface LateDeallocationRunStart {
    opId: number;
    /** Position in the rendered row list, used to place the dot and to scroll. */
    rowIndex: number;
    /** Tensors whose stale run begins on this row. Never empty. */
    tensors: TensorDeallocationReport[];
}

export const LATE_DEALLOC_OPPORTUNITY_TEXT = 'Opportunity to deallocate earlier';

export const LATE_DEALLOC_RAIL_LABEL = 'Operations holding tensors past their last use';
