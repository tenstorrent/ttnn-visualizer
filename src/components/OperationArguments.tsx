// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import 'styles/components/OperationArguments.scss';
import { ScrollToOptions } from '@tanstack/react-virtual';
import ExpandableTensor from './ExpandableTensor';
import MicroOperations from './MicroOperations';
import { MicroOperation } from '../model/Graph';

interface Arguments {
    name: string;
    value: string;
}

interface OperationArgumentsProps {
    operationId: number;
    operationIndex: number;
    argumentsData: Arguments[];
    microOperations: MicroOperation[];
    scrollTo: (index: number, { align, behavior }: ScrollToOptions) => void;
}

function OperationArguments({
    operationId,
    operationIndex,
    argumentsData,
    microOperations,
    scrollTo,
}: OperationArgumentsProps) {
    return (
        <>
            <table className='arguments-table has-vertical-headings'>
                <caption>Arguments</caption>

                <tbody>
                    {argumentsData?.map((arg) => (
                        <tr key={`${operationId}-${arg.name}`}>
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

            {microOperations?.length ? <MicroOperations microOperations={microOperations} /> : null}
        </>
    );
}

function isLengthyTensor(value: string) {
    return value.toLowerCase().includes('\n');
}

export default OperationArguments;
