// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import 'styles/components/BufferTable.scss';
import { Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { Tensor } from '../model/Graph';
import { OperationDescription } from '../model/APIData';
import { useNextBuffer } from '../hooks/useAPI';
import { toHex } from '../functions/math';
import ROUTES from '../definitions/routes';

interface BufferTableProps {
    tensor: Tensor;
    operations: OperationDescription[];
    queryKey: string;
    className?: string;
}

function BufferTable({ tensor, operations, queryKey, className }: BufferTableProps) {
    const { address, consumers } = tensor;
    const lastOperation = tensor.consumers[tensor.consumers.length - 1];
    const deallocationOperation = getDeallocation(tensor, operations);
    const { data: buffer, isLoading } = useNextBuffer(address, consumers, queryKey);

    return (
        <table className={classNames('buffer-table', className)}>
            <tbody>
                <tr>
                    <th>Last used</th>
                    <td>
                        Last used by{' '}
                        <a href={`${ROUTES.OPERATIONS}/${lastOperation}`}>
                            Operation {lastOperation}{' '}
                            {operations.find((operation) => operation.id === lastOperation)?.name}
                        </a>
                    </td>
                </tr>

                <tr>
                    <th>Deallocation</th>
                    <td>
                        {isLoading ? 'Loading...' : undefined}

                        {buffer && !isLoading && deallocationOperation ? (
                            <div>
                                Deallocation found in{' '}
                                <a href={`${ROUTES.OPERATIONS}/${deallocationOperation}`}>
                                    Operation {deallocationOperation}{' '}
                                    {
                                        operations.find(
                                            (operation) => operation.id === parseInt(deallocationOperation, 10),
                                        )?.name
                                    }
                                </a>
                                <Icon
                                    className='deallocation-icon'
                                    icon={IconNames.TICK}
                                    intent={Intent.SUCCESS}
                                />
                            </div>
                        ) : (
                            <div>
                                Missing deallocation operation
                                <Icon
                                    className='deallocation-icon'
                                    icon={IconNames.WARNING_SIGN}
                                    intent={Intent.WARNING}
                                />
                            </div>
                        )}
                    </td>
                </tr>

                {isLoading ||
                    (address && (
                        <tr>
                            <th>Next allocation</th>
                            <td>
                                {isLoading ? 'Loading...' : undefined}
                                {buffer?.next_usage && address && !isLoading ? (
                                    <span>
                                        {toHex(address)} next allocated in{' '}
                                        <a href={`${ROUTES.OPERATIONS}/${buffer.operation_id}`}>
                                            Operation {buffer.operation_id}{' '}
                                            {operations.find((operation) => operation.id === buffer.operation_id)?.name}
                                        </a>{' '}
                                        (+{buffer.next_usage} operations)
                                    </span>
                                ) : (
                                    'No subsequent buffer found at this address'
                                )}
                            </td>
                        </tr>
                    ))}
            </tbody>
        </table>
    );
}

function getDeallocation(tensor: Tensor, operations: OperationDescription[]) {
    // TODO: Maybe we can strengthen this logic to ensure we're looking at deallocations rather than just checking the name
    const matchingInputs = operations.filter(
        (operation) =>
            operation.name.includes('deallocate') && operation.inputs.find((input) => input.id === tensor.id),
    );

    return matchingInputs.map((x) => x.id).toString();
}

export default BufferTable;
