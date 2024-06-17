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
        <>
            {isExpanded ? (
                <pre>{tensor}</pre>
            ) : (
                <>
                    <p>{splitTensor[0]}</p>
                    <p>.........</p>
                    <p>{splitTensor[splitTensor.length - 1]}</p>
                </>
            )}
            <Switch
                className='expandable-tensor'
                label={isExpanded ? 'Hide full tensor' : 'Show full tensor'}
                onChange={() => setIsExpanded((previousValue) => !previousValue)}
                checked={isExpanded}
            />
        </>
    );
}

export default ExpandableTensor;
