// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo, useContext } from 'react';
import OpGraphNodeExpander from './OpGraphNodeExpander';
import { OpGraphBlockExpansionContext } from './opGraphExpansionContext';

interface OpGraphBlockExpanderProps {
    instanceId: string;
    opCount: number;
    isExpanded: boolean;
}

const OpGraphBlockExpander = memo(({ instanceId, opCount, isExpanded }: OpGraphBlockExpanderProps) => {
    const toggleBlock = useContext(OpGraphBlockExpansionContext);

    return (
        <OpGraphNodeExpander
            action={isExpanded ? `Fold ${opCount} operations` : `Unroll ${opCount} operations`}
            count={opCount}
            isExpanded={isExpanded}
            onToggle={() => toggleBlock(instanceId)}
        />
    );
});

OpGraphBlockExpander.displayName = 'OpGraphBlockExpander';

export default OpGraphBlockExpander;
