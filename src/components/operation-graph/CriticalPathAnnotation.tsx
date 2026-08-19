// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { formatDuration } from '../../functions/formatting';
import 'styles/components/CriticalPath.scss';

interface CriticalPathAnnotationProps {
    opCount: number;
    totalNs: number;
    /** Device time across every linked op in the graph, the share's denominator. */
    measuredNs: number;
    /** A cycle held part of the graph back, so the path and total understate. */
    isPartial?: boolean;
}

const CriticalPathAnnotation = ({ opCount, totalNs, measuredNs, isPartial = false }: CriticalPathAnnotationProps) => {
    // Device time is the only measured quantity, so the share is of summed op
    // time, not wall clock — said plainly, because "of measured time" reads as
    // wall clock. One decimal matches the per-op hover, where rounding to whole
    // percent prints 0% for a short path on a large graph.
    const share = measuredNs > 0 ? `${((totalNs / measuredNs) * 100).toFixed(1)}% of total device time` : null;

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
                {isPartial ? 'Critical path (partial)' : 'Critical path'}: {opCount} {opCount === 1 ? 'op' : 'ops'} ·{' '}
                {formatDuration(totalNs)}
                {share === null ? null : ` · ${share}`}
            </span>
        </div>
    );
};

export default CriticalPathAnnotation;
