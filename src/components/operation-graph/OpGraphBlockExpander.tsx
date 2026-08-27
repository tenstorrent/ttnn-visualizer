// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type MouseEvent as ReactMouseEvent, memo, useContext } from 'react';
import { OpGraphBlockExpansionContext } from './opGraphExpansionContext';

interface OpGraphBlockExpanderProps {
    instanceId: string;
    opCount: number;
    isExpanded: boolean;
}

const OpGraphBlockExpander = memo(({ instanceId, opCount, isExpanded }: OpGraphBlockExpanderProps) => {
    const toggleBlock = useContext(OpGraphBlockExpansionContext);

    // React Flow reads selection off `mousedown`, so without this the expander
    // would also select the operation and start the centring tween that goes with
    // it — the graph would jump before it expanded. Structural navigation and
    // selection stay separate gestures.
    const handleMouseDown = (event: ReactMouseEvent) => event.stopPropagation();

    const handleClick = (event: ReactMouseEvent) => {
        event.stopPropagation();
        toggleBlock(instanceId);
    };

    // Also the accessible name: `title` only supplies one when the element has no
    // content, and the count is content — so without this the button announced as
    // the bare number.
    const action = isExpanded ? `Fold ${opCount} operations` : `Unroll ${opCount} operations`;

    return (
        <button
            type='button'
            // `nodrag`/`nopan` keep the button from doubling as a drag or pan surface.
            className='op-graph-node-expander nodrag nopan'
            title={action}
            aria-label={action}
            aria-expanded={isExpanded}
            onMouseDown={handleMouseDown}
            onClick={handleClick}
        >
            {/* Down opens, up closes — a chevron that only reported the current
                state read as "expand further". Same glyph, rotated: `▴` sits
                high in the em-box and the count looks dropped beside it. */}
            <span
                aria-hidden='true'
                className='op-graph-node-expander-icon'
            >
                ▾
            </span>
            {opCount}
        </button>
    );
});

OpGraphBlockExpander.displayName = 'OpGraphBlockExpander';

export default OpGraphBlockExpander;
