// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type MouseEvent as ReactMouseEvent, memo } from 'react';

interface OpGraphNodeExpanderProps {
    /** Title and accessible name; the two toggles word it differently. */
    action: string;
    count: number;
    isExpanded: boolean;
    onToggle: () => void;
}

/**
 * @description The count chip on a node that opens into something — device
 * operations, or a folded block's members. Presentational: the callers own the
 * wording and bind the context toggle, which is all the two of them ever differed
 * in. They were otherwise identical down to the comments, so a fix to the
 * mousedown behaviour had to land twice or one comment started lying.
 */
const OpGraphNodeExpander = memo(({ action, count, isExpanded, onToggle }: OpGraphNodeExpanderProps) => {
    // React Flow reads selection off `mousedown`, so without this the expander
    // would also select the operation and start the centring tween that goes with
    // it — the graph would jump before it expanded. Structural navigation and
    // selection stay separate gestures.
    const handleMouseDown = (event: ReactMouseEvent) => event.stopPropagation();

    const handleClick = (event: ReactMouseEvent) => {
        event.stopPropagation();
        onToggle();
    };

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
            {count}
        </button>
    );
});

OpGraphNodeExpander.displayName = 'OpGraphNodeExpander';

export default OpGraphNodeExpander;
