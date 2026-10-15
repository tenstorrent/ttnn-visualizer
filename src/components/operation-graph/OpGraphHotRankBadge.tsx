// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { HOT_OPS_NO_RANK_LABEL } from '../../definitions/HotOps';

interface OpGraphHotRankBadgeProps {
    rank: number | null;
}

/** Marks an op the slowest-operations list shows, so the list's picks can be found on the graph. #2085 */
const OpGraphHotRankBadge = ({ rank }: OpGraphHotRankBadgeProps) => (
    <span
        className='op-graph-node-hot-rank'
        title={rank === null ? 'Slowest operations: no perf data' : `Slowest operations: #${rank}`}
    >
        {rank ?? HOT_OPS_NO_RANK_LABEL}
    </span>
);

export default OpGraphHotRankBadge;
