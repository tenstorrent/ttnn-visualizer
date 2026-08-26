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

    const handleMouseDown = (event: ReactMouseEvent) => event.stopPropagation();

    const handleClick = (event: ReactMouseEvent) => {
        event.stopPropagation();
        toggleBlock(instanceId);
    };

    const action = isExpanded ? `Fold ${opCount} operations` : `Unroll ${opCount} operations`;

    return (
        <button
            type='button'
            className='op-graph-node-expander nodrag nopan'
            title={action}
            aria-label={action}
            aria-expanded={isExpanded}
            onMouseDown={handleMouseDown}
            onClick={handleClick}
        >
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
