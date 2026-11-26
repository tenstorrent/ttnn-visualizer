// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Icon, IconName } from '@blueprintjs/core';
import { type MouseEvent as ReactMouseEvent, memo } from 'react';

interface OpGraphNodeExpanderProps {
    /** Title and accessible name; the two toggles word it differently. */
    action: string;
    count: number;
    isExpanded: boolean;
    onToggle: () => void;
    /** Replaces the fold chevron, for a chip that opens something other than a folded block. */
    icon?: IconName;
}

/**
 * @description The count chip on a node that opens into something — device
 * operations, or a folded block's members. Presentational: the callers own the
 * wording, the glyph and the context toggle. They were otherwise identical down
 * to the comments, so a fix to the mousedown behaviour had to land twice or one
 * comment started lying.
 */
const OpGraphNodeExpander = memo(({ action, count, isExpanded, onToggle, icon }: OpGraphNodeExpanderProps) => {
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
            {icon ? (
                <Icon
                    icon={icon}
                    size={12}
                />
            ) : (
                // Down opens, up closes — a chevron that only reported the current
                // state read as "expand further". Same glyph, rotated: `▴` sits
                // high in the em-box and the count looks dropped beside it.
                <span
                    aria-hidden='true'
                    className='op-graph-node-expander-icon'
                >
                    ▾
                </span>
            )}
            {count}
        </button>
    );
});

OpGraphNodeExpander.displayName = 'OpGraphNodeExpander';

export default OpGraphNodeExpander;
