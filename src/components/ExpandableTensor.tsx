// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import { Switch } from '@blueprintjs/core';
import { useRef, useState } from 'react';
import 'styles/components/ExpandableTensor.scss';

interface ExpandableTensorProps {
    tensor: string;
}

function ExpandableTensor({ tensor }: ExpandableTensorProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const splitTensor = tensor.split('\n');
    const cellRef = useRef<null | HTMLTableCellElement>(null);

    function handleExpandToggle(shouldScrollTo?: boolean) {
        setIsExpanded((previousValue) => !previousValue);

        if (shouldScrollTo) {
            cellRef.current?.scrollIntoView();
        }
    }

    return (
        <td className='expandable-tensor' ref={cellRef}>
            <Switch
                className='expand-button'
                label={isExpanded ? 'Hide full tensor' : 'Show full tensor'}
                onChange={() => handleExpandToggle()}
                checked={isExpanded}
            />
            {isExpanded ? (
                <>
                    <pre>{tensor}</pre>
                    <Switch
                        className='expand-button'
                        label='Hide full tensor'
                        onChange={() => handleExpandToggle(true)}
                        checked={isExpanded}
                    />
                </>
            ) : (
                <>
                    <p>{splitTensor[0]}</p>
                    <p>.........</p>
                    <p>{splitTensor[splitTensor.length - 1]}</p>
                </>
            )}
        </td>
    );
}

export default ExpandableTensor;
