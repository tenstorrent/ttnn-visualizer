// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import 'styles/components/OperationArguments.scss';

interface Arguments {
    name: string;
    value: string;
}

interface OperationArgumentsProps {
    data: Array<Arguments>;
}

function OperationArguments({ data }: OperationArgumentsProps) {
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
                    <tr>
                        <td>{arg.name}</td>
                        <td>{arg.value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default OperationArguments;
