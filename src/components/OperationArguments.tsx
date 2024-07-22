// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import 'styles/components/OperationArguments.scss';
import { ScrollToOptions } from '@tanstack/react-virtual';
import ExpandableTensor from './ExpandableTensor';
import OperationHistory from '../definitions/operationHistory.json';
import MicroOperations from './MicroOperations';

interface Arguments {
    name: string;
    value: string;
}

interface OperationArgumentsProps {
    operationId: number;
    operationIndex: number;
    argumentsData: Array<Arguments>;
    scrollTo: (index: number, { align, behavior }: ScrollToOptions) => void;
}

function OperationArguments({ operationId, operationIndex, argumentsData, scrollTo }: OperationArgumentsProps) {
    const microOperations = OperationHistory.filter((microOp) => microOp.ttnn_operation_id === operationId);

    return (
        <>
            <table className='operation-arguments'>
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
