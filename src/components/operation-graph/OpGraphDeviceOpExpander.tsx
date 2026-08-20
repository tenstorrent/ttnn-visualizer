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

    return (
        <button
            type='button'
            // `nodrag`/`nopan` keep the button from doubling as a drag or pan surface.
            className='op-graph-node-expander nodrag nopan'
            title={isExpanded ? 'Hide device operations' : `Show ${count} device operations`}
            aria-expanded={isExpanded}
            onMouseDown={handleMouseDown}
            onClick={handleClick}
        >
            <span aria-hidden='true'>{isExpanded ? '▾' : '▸'}</span>
            {count}
        </button>
    );
});

OpGraphDeviceOpExpander.displayName = 'OpGraphDeviceOpExpander';

export default OpGraphDeviceOpExpander;
