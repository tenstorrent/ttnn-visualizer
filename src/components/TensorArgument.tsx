// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { Switch } from '@blueprintjs/core';
import { useState } from 'react';
import 'styles/components/TensorArgument.scss';
import parseMemoryConfig, { ShardSpec } from '../functions/parseMemoryConfig';
import MemoryConfigRow from './MemoryConfigRow';

interface TensorArgumentProps {
    argument: {
        name: string;
        value: string;
    };
    onCollapse?: () => void;
}

function TensorArgument({ argument, onCollapse }: TensorArgumentProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const splitArgument = argument.value.split('\n');

    const handleExpandToggle = () => {
        setIsExpanded((previousValue) => !previousValue);

        if (isExpanded === true && onCollapse) {
            onCollapse();
        }
    };

    if (argument.name === 'memory_config') {
        const parsedArgument = Object.entries(parseMemoryConfig(argument.value));

        return (
            <table className='ttnn-table alt-two-tone-rows buffer-table'>
                <tbody>
                    {parsedArgument?.map(([key, value]) => (
                        <MemoryConfigRow
                            key={key}
                            header={key}
                            value={value as string | ShardSpec}
                        />
                    ))}
                </tbody>
            </table>
        );
    }

    if (!isLengthyTensor(argument.value)) {
        return argument.value;
    }

    return (
        <div className='expandable-argument'>
            <Switch
                className='expand-button'
                label={isExpanded ? 'Hide full tensor' : 'Show full tensor'}
                onChange={() => handleExpandToggle()}
                checked={isExpanded}
            />

            {isExpanded ? (
                <>
                    <pre className='full-tensor'>{argument.value}</pre>

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
                    <p className='collapsed-tensor monospace'>{splitArgument[0]}</p>
                    <p className='collapsed-tensor monospace'>.........</p>
                    <p className='collapsed-tensor monospace'>{splitArgument[splitArgument.length - 1]}</p>
                </>
            )}
        </div>
    );
}

function isLengthyTensor(value: string) {
    return value.toLowerCase().includes('\n');
}

export default TensorArgument;
