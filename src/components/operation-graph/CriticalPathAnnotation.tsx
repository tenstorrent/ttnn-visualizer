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
}

const CriticalPathAnnotation = ({ opCount, totalNs, measuredNs }: CriticalPathAnnotationProps) => {
    const share = measuredNs > 0 ? Math.round((totalNs / measuredNs) * 100) : null;

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
                Critical path: {opCount} {opCount === 1 ? 'op' : 'ops'}, {formatDuration(totalNs)} total
                {share === null ? null : ` (${share}% of measured time)`}
            </span>
        </div>
    );
};

export default CriticalPathAnnotation;
