// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Switch } from '@blueprintjs/core';
import { useState } from 'react';
import 'styles/components/TensorArgument.scss';
import { MemoryConfig, ShardSpec } from '../functions/parseMemoryConfig';
import MemoryConfigRow from './MemoryConfigRow';

interface TensorArgumentProps {
    argument: {
        name: string;
        value: string;
        parsedValue: MemoryConfig | null;
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

    if (argument?.parsedValue) {
        return (
            <table className='ttnn-table alt-two-tone-rows buffer-table'>
                <tbody>
                    {argument.parsedValue &&
                        Object.entries(argument.parsedValue)?.map(([key, value]) => (
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

    if (typeof argument.value === 'string' && !isLengthyTensor(argument.value)) {
        return argument.value;
    }

    return (
        <div className='expandable-argument'>
            <Switch
                label={isExpanded ? 'Hide full tensor' : 'Show full tensor'}
                onChange={() => handleExpandToggle()}
                checked={isExpanded}
            />

            {isExpanded ? (
                <>
                    {typeof argument.value === 'string' && (
                        <pre className='full-tensor'>{argument.value as string}</pre>
                    )}

                    {onCollapse && (
                        <Switch
                            label='Hide full tensor'
                            onChange={() => handleExpandToggle()}
                            checked={isExpanded}
                        />
                    )}
                </>
            ) : (
                Array.isArray(splitArgument) && (
                    <>
                        <p className='collapsed-tensor monospace'>{splitArgument[0]}</p>
                        <p className='collapsed-tensor monospace'>.........</p>
                        <p className='collapsed-tensor monospace'>{splitArgument[splitArgument.length - 1]}</p>
                    </>
                )
            )}
        </div>
    );
}

function isLengthyTensor(value: string) {
    return value.toLowerCase().includes('\n');
}

export default TensorArgument;
