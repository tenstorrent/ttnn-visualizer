// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { Switch } from '@blueprintjs/core';
import { useState } from 'react';
import 'styles/components/OperationArguments.scss';

interface Arguments {
    name: string;
    value: string;
}

interface OperationArgumentsProps {
    operationId: number;
    data: Array<Arguments>;
}

function OperationArguments({ operationId, data }: OperationArgumentsProps) {
    return (
        <table className='operation-arguments'>
            <caption>Arguments</caption>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Value</th>
                </tr>
            </thead>
            <tbody>
                {data?.map((arg) => (
                    <tr key={`${operationId}-${arg.name}`}>
                        <td>{arg.name}</td>
                        <td>{isTensor(arg.value) ? <ParsedTensor tensor={arg.value} /> : arg.value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function isTensor(value: string) {
    return value.toLowerCase().includes('tensor');
}

interface ParsedTensorProps {
    tensor: string;
}

function ParsedTensor({ tensor }: ParsedTensorProps) {
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
                label={isExpanded ? 'Hide full tensor' : 'Show full tensor'}
                onChange={() => setIsExpanded((previousValue) => !previousValue)}
                checked={isExpanded}
            />
        </>
    );
}

export default OperationArguments;
