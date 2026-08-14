// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import type { OpGraphFlowEdge } from './opGraphTypes';

// One op can feed the same consumer from two different output tensors, which is
// 20% of edges on a real report. vis auto-curved the twin; React Flow would draw
// it exactly under the first and lose its label, so the twin is bowed out. #1809
const PARALLEL_EDGE_OFFSET_PX = 60;

const OpGraphEdge = memo(
    ({ id, sourceX, sourceY, targetX, targetY, label, data, markerEnd, style }: EdgeProps<OpGraphFlowEdge>) => {
        const offset = (data?.parallelIndex ?? 0) * PARALLEL_EDGE_OFFSET_PX;
        const midY = (sourceY + targetY) / 2;
        const path = `M ${sourceX},${sourceY} C ${sourceX + offset},${midY} ${targetX + offset},${midY} ${targetX},${targetY}`;

        return (
            <>
                <BaseEdge
                    id={id}
                    path={path}
                    markerEnd={markerEnd}
                    style={style}
                />
                {label ? (
                    <text
                        className='op-graph-edge-label'
                        x={(sourceX + targetX) / 2 + offset * 0.75}
                        y={midY}
                    >
                        {label}
                    </text>
                ) : null}
            </>
        );
    },
);

OpGraphEdge.displayName = 'OpGraphEdge';

export default OpGraphEdge;
