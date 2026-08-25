// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BaseEdge, type EdgeProps, useStore } from '@xyflow/react';
import { memo } from 'react';
import type { OpGraphFlowEdge } from './opGraphTypes';

// An op feeding the same consumer from two output tensors is 20% of edges on a
// real report; undisplaced, the twin hides under the first and loses its label.
const PARALLEL_EDGE_BOW_PX = 80;

// Below this the 10px label draws under 7px, past reading, and a report's ~500
// of them still cost a text layout and repaint on every pan frame. Selecting a
// zoom that hides them is how a whole-graph overview stays interactive.
const EDGE_LABEL_MIN_ZOOM = 0.7;

const OpGraphEdge = memo(
    ({ id, sourceX, sourceY, targetX, targetY, label, data, markerEnd, style }: EdgeProps<OpGraphFlowEdge>) => {
        // A boolean selector re-renders the edge only when the threshold is
        // crossed, not on every wheel tick of a continuous zoom.
        const isLabelLegible = useStore((state) => state.transform[2] >= EDGE_LABEL_MIN_ZOOM);
        const bow = (data?.parallelIndex ?? 0) * PARALLEL_EDGE_BOW_PX;
        const midY = (sourceY + targetY) / 2;

        // Bowing along the chord's perpendicular separates twins at any
        // orientation; a fixed x offset leaves wide, shallow pairs coincident.
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

        // The cubic at t=0.5, so each twin's label rides its own curve.
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
                {label && isLabelLegible ? (
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
