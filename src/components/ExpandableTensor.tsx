// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { Switch } from '@blueprintjs/core';
import { useState } from 'react';
import 'styles/components/ExpandableTensor.scss';

interface ExpandableTensorProps {
    tensor: string;
    onCollapse?: () => void;
}

function ExpandableTensor({ tensor, onCollapse }: ExpandableTensorProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const splitTensor = tensor.split('\n');

    const handleExpandToggle = () => {
        setIsExpanded((previousValue) => !previousValue);

        if (isExpanded === true && onCollapse) {
            onCollapse();
        }
    };

    if (!isLengthyTensor(tensor)) {
        return tensor;
    }

    return (
        <div className='expandable-tensor'>
            <Switch
                className='expand-button'
                label={isExpanded ? 'Hide full tensor' : 'Show full tensor'}
                onChange={() => handleExpandToggle()}
                checked={isExpanded}
            />

            {isExpanded ? (
                <>
                    <pre className='full-tensor'>{tensor}</pre>

                    {onCollapse && (
                        <Switch
                            className='expand-button'
                            label='Hide full tensor'
                            onChange={() => handleExpandToggle()}
                            checked={isExpanded}
                        />
                    )}
                </>
            ) : (
                <>
                    <p className='collapsed-tensor monospace'>{splitTensor[0]}</p>
                    <p className='collapsed-tensor monospace'>.........</p>
                    <p className='collapsed-tensor monospace'>{splitTensor[splitTensor.length - 1]}</p>
                </>
            )}
        </div>
    );
}

function isLengthyTensor(value: string) {
    return value.toLowerCase().includes('\n');
}

export default ExpandableTensor;
