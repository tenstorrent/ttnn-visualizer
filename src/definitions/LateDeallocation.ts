// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { TensorDeallocationReport } from '../model/BufferSummary';

/**
 * A row where at least one tensor *becomes* stale (#963).
 *
 * Late-deallocated tensors are reported on every row from their last use until
 * they are freed. The gutter badges follow those rows, since a hatched row
 * with no marker beside it reads as a marker that went missing. The rail can't:
 * dotting every continuation row would draw a solid bar down the gutter and
 * bury the rows where something actually changed, so it plots run starts and
 * they are what the count beside the toggle counts.
 */
export interface LateDeallocationRunStart {
    opId: number;
    /** Position in the rendered row list, used to place the dot and to scroll. */
    rowIndex: number;
    /** Tensors whose stale run begins on this row. Never empty. */
    tensors: TensorDeallocationReport[];
}

export const LATE_DEALLOC_OPPORTUNITY_TEXT = 'Opportunity to deallocate earlier';

export const LATE_DEALLOC_RAIL_LABEL = 'Operations where a tensor starts being held past its last use';
