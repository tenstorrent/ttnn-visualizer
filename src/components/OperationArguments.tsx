// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import 'styles/components/OperationArguments.scss';
import { ScrollToOptions } from '@tanstack/react-virtual';
import ExpandableTensor from './ExpandableTensor';
import { Operation } from '../model/Graph';

interface OperationArgumentsProps {
    operation: Operation;
    operationIndex?: number;
    scrollTo?: (index: number, { align, behavior }: ScrollToOptions) => void;
}

function OperationArguments({ operationIndex, operation, scrollTo }: OperationArgumentsProps) {
    const { id, arguments: operationArguments } = operation;

    return (
        <table className='arguments-table has-vertical-headings'>
            <caption>Arguments</caption>

            <tbody>
                {operationArguments?.map((arg) => (
                    <tr key={`${id}-${arg.name}`}>
                        <td>{arg.name}</td>

                        {isLengthyTensor(arg.value) ? (
                            <ExpandableTensor
                                tensor={arg.value}
                                operationIndex={operationIndex}
                                scrollTo={scrollTo}
                            />
                        ) : (
                            <td>{arg.value}</td>
                        )}
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
