// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import { Switch } from '@blueprintjs/core';
import { useState } from 'react';
import 'styles/components/ExpandableTensor.scss';

interface ExpandableTensorProps {
    tensor: string;
}

function ExpandableTensor({ tensor }: ExpandableTensorProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const splitTensor = tensor.split('\n');

    return (
        <td className='expandable-tensor'>
            <div className='expandable-tensor-tools'>
                <Switch
                    className='expand-button'
                    label={isExpanded ? 'Hide full tensor' : 'Show full tensor'}
                    onChange={() => setIsExpanded((previousValue) => !previousValue)}
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
