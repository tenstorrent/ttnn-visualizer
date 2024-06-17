// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import 'styles/components/OperationArguments.scss';
import ExpandableTensor from './ExpandableTensor';

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
            <tbody>
                {data?.map((arg) => (
                    <tr key={`${operationId}-${arg.name}`}>
                        <td>{arg.name}</td>
                        {isLengthyTensor(arg.value) ? <ExpandableTensor tensor={arg.value} /> : <td>{arg.value}</td>}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function isLengthyTensor(value: string) {
    return value.toLowerCase().includes('\n');
}

export default OperationArguments;
