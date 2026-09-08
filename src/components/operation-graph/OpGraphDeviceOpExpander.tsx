// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo, useContext } from 'react';
import OpGraphNodeExpander from './OpGraphNodeExpander';
import { OpGraphExpansionContext } from './opGraphExpansionContext';

interface OpGraphDeviceOpExpanderProps {
    operationId: number;
    count: number;
    isExpanded: boolean;
}

const OpGraphDeviceOpExpander = memo(({ operationId, count, isExpanded }: OpGraphDeviceOpExpanderProps) => {
    const toggleExpansion = useContext(OpGraphExpansionContext);

    return (
        <OpGraphNodeExpander
            // Also the accessible name: `title` only supplies one when the element
            // has no content, and the count is content — so without this the button
            // announced as the bare number.
            action={isExpanded ? 'Hide device operations' : `Show ${count} device operations`}
            count={count}
            isExpanded={isExpanded}
            onToggle={() => toggleExpansion(operationId)}
        />
    );
});

OpGraphDeviceOpExpander.displayName = 'OpGraphDeviceOpExpander';

export default OpGraphDeviceOpExpander;
