// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import type { OpGraphFlowEdge } from './opGraphTypes';

// One op can feed the same consumer from two different output tensors, which is
// 20% of edges on a real report. vis auto-curved the twin; React Flow would draw
// it exactly under the first and lose its label, so the twin is bowed out. #1809
const PARALLEL_EDGE_BOW_PX = 80;

const OpGraphEdge = memo(
    ({ id, sourceX, sourceY, targetX, targetY, label, data, markerEnd, style }: EdgeProps<OpGraphFlowEdge>) => {
        const bow = (data?.parallelIndex ?? 0) * PARALLEL_EDGE_BOW_PX;
        const midY = (sourceY + targetY) / 2;

        // Bowing along the perpendicular of the chord rather than along x keeps
        // twins apart in both orientations: a vertical pair splits sideways, a
        // near-horizontal pair splits vertically. Offsetting x alone left the
        // wide, shallow pairs almost coincident.
        const spanX = targetX - sourceX;
        const spanY = targetY - sourceY;
        const span = Math.hypot(spanX, spanY) || 1;
        const bowX = (-spanY / span) * bow;
        const bowY = (spanX / span) * bow;

        const control1X = sourceX + bowX;
        const control1Y = midY + bowY;
        const control2X = targetX + bowX;
        const control2Y = midY + bowY;
        const path = `M ${sourceX},${sourceY} C ${control1X},${control1Y} ${control2X},${control2Y} ${targetX},${targetY}`;

        // The cubic evaluated at t=0.5, so each twin's label rides its own curve
        // instead of both landing on the chord midpoint.
        const labelX = (sourceX + 3 * control1X + 3 * control2X + targetX) / 8;
        const labelY = (sourceY + 3 * control1Y + 3 * control2Y + targetY) / 8;

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
                        x={labelX}
                        y={labelY}
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
