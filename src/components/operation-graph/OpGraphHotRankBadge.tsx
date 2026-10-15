// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { HOT_OPS_NO_RANK_LABEL } from '../../definitions/HotOps';

interface OpGraphHotRankBadgeProps {
    /** `undefined` when the list doesn't show the node's op, `null` for one without perf data. */
    rank: number | null | undefined;
}

const OpGraphHotRankBadge = ({ rank }: OpGraphHotRankBadgeProps) =>
    rank === undefined ? null : (
        <span
            className='op-graph-node-hot-rank'
            title={rank === null ? 'Slowest operations: no perf data' : `Slowest operations: #${rank}`}
        >
            {rank ?? HOT_OPS_NO_RANK_LABEL}
        </span>
    );

export default OpGraphHotRankBadge;
