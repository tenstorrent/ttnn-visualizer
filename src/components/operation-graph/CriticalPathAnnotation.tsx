// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo } from 'react';
import { formatDuration } from '../../functions/formatting';
import 'styles/components/CriticalPathAnnotation.scss';

interface CriticalPathAnnotationProps {
    opCount: number;
    totalNs: number;
    /** Device time across every linked op in the graph, the share's denominator. */
    measuredNs: number;
    /** A cycle held part of the graph back, so the path and total understate. */
    isPartial?: boolean;
}

// Memoised on primitive props: a node drag pushes position changes through
// `setNodes` every frame, and each render here builds an `Intl.NumberFormat` by
// way of `formatDuration`.
const CriticalPathAnnotation = memo(
    ({ opCount, totalNs, measuredNs, isPartial = false }: CriticalPathAnnotationProps) => {
        // The share is of summed per-op kernel duration, not wall clock, and names
        // the measure the legend and the details panel already use for it. One
        // decimal matches the per-op hover, where rounding to whole percent prints
        // 0% for a short path on a large graph.
        const share = measuredNs > 0 ? `${((totalNs / measuredNs) * 100).toFixed(1)}% of total kernel duration` : null;

        return (
            <div
                className='critical-path-annotation'
                aria-label='Critical path summary'
            >
                <span
                    className='critical-path-annotation-accent'
                    aria-hidden='true'
                />
                <span>
                    {isPartial ? 'Critical path (partial)' : 'Critical path'}: {opCount} {opCount === 1 ? 'op' : 'ops'}{' '}
                    · {formatDuration(totalNs)}
                    {share === null ? null : ` · ${share}`}
                </span>
            </div>
        );
    },
);

CriticalPathAnnotation.displayName = 'CriticalPathAnnotation';

export default CriticalPathAnnotation;
