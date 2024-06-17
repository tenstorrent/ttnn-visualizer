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

    function handleExpandToggle() {
        setIsExpanded((previousValue) => !previousValue);

        cellRef?.current?.scrollIntoView();
    }

    return (
        <td className='expandable-tensor' ref={cellRef}>
            <div className='expandable-tensor-tools'>
                <Switch
                    className='expand-button'
                    label={isExpanded ? 'Hide full tensor' : 'Show full tensor'}
                    onChange={() => handleExpandToggle()}
                    checked={isExpanded}
                />
            </div>
            {isExpanded ? (
                <pre>{tensor}</pre>
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
