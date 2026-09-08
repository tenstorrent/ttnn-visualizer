// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo } from 'react';
import { Tooltip } from '@blueprintjs/core';
import { TensorDeallocationReport } from '../../model/BufferSummary';
import { getLateDeallocationSummary } from '../../functions/lateDeallocation';
import { TEST_IDS } from '../../definitions/TestIds';
import LateDeallocationGlyph from './LateDeallocationGlyph';

interface LateDeallocationBadgeProps {
    operationId: number;
    /**
     * The stale tensors this row is holding. One array per operation, built once
     * per report by `useGetTensorDeallocationReportByOperation`, which is what
     * makes the memo below hold.
     */
    tensors: readonly TensorDeallocationReport[];
    /** Suppresses the tooltip mid-scroll, as the row label's does. */
    isScrolling: boolean;
}

/**
 * Gutter marker for a row still holding a stale tensor (#963).
 *
 * Memoised, and it builds its own summary rather than being handed one: the
 * virtualized list re-renders on every scroll tick, and late deallocation is the
 * case where most visible rows carry a badge, so composing a tooltip string per
 * row per frame — for text only ever read on hover — was the common path rather
 * than the edge case.
 */
function LateDeallocationBadge({ operationId, tensors, isScrolling }: LateDeallocationBadgeProps) {
    const summary = getLateDeallocationSummary(tensors);

    return (
        <Tooltip
            className='y-axis-tick-badge'
            content={summary}
            placement='left'
            disabled={isScrolling}
        >
            {/* A glyph rather than a number, so it can't be misread as a rank
                sitting next to the top-N badge. The accessible name goes on the
                wrapper because `LateDeallocationGlyph` is decorative, and it
                names the tensors the glyph can't. */}
            <span
                className='late-dealloc-badge'
                role='img'
                aria-label={summary}
                data-testid={`${TEST_IDS.LATE_DEALLOC_BADGE}-${operationId}`}
            >
                <LateDeallocationGlyph />
            </span>
        </Tooltip>
    );
}

export default memo(LateDeallocationBadge);
