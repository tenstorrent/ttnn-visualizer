// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type MouseEvent as ReactMouseEvent, memo, useContext } from 'react';
import { OpGraphExpansionContext } from './opGraphExpansionContext';

interface OpGraphDeviceOpExpanderProps {
    operationId: number;
    count: number;
    isExpanded: boolean;
}

const OpGraphDeviceOpExpander = memo(({ operationId, count, isExpanded }: OpGraphDeviceOpExpanderProps) => {
    const toggleExpansion = useContext(OpGraphExpansionContext);

    // React Flow reads selection off `mousedown`, so without this the expander
    // would also select the operation and start the centring tween that goes with
    // it — the graph would jump before it expanded. Structural navigation and
    // selection stay separate gestures.
    const handleMouseDown = (event: ReactMouseEvent) => event.stopPropagation();

    const handleClick = (event: ReactMouseEvent) => {
        event.stopPropagation();
        toggleExpansion(operationId);
    };

    // Also the accessible name: `title` only supplies one when the element has no
    // content, and the count is content — so without this the button announced as
    // the bare number.
    const action = isExpanded ? 'Hide device operations' : `Show ${count} device operations`;

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
            {/* The arrow names the action rather than the state: down opens the
                subgraph, up closes it. A chevron that merely rotated to report
                what is already visible on screen read as "expand further". */}
            <span aria-hidden='true'>{isExpanded ? '▴' : '▾'}</span>
            {count}
        </button>
    );
});

OpGraphDeviceOpExpander.displayName = 'OpGraphDeviceOpExpander';

export default OpGraphDeviceOpExpander;
