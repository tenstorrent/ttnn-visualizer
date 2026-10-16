// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { HOT_OPS_NO_RANK_LABEL, HOT_OPS_TITLE } from '../../definitions/HotOps';
import { NO_PERF_DATA_LABEL } from '../../definitions/PerfOverlayStatus';

interface OpGraphHotRankBadgeProps {
    /** Absent when the list doesn't show the node's op, `null` for one without perf data. */
    rank?: number | null;
}

const OpGraphHotRankBadge = ({ rank }: OpGraphHotRankBadgeProps) => {
    if (rank === undefined) {
        return null;
    }
    // Named, not only titled: read out bare, the digit runs into the node's own text.
    const label = `${HOT_OPS_TITLE}: ${rank === null ? NO_PERF_DATA_LABEL : `rank ${rank}`}`;
    return (
        <span
            className='op-graph-node-hot-rank'
            role='img'
            aria-label={label}
            title={label}
        >
            {rank ?? HOT_OPS_NO_RANK_LABEL}
        </span>
    );
};

export default OpGraphHotRankBadge;
