// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import 'styles/components/BufferTable.scss';
import { Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { Tensor } from '../model/Graph';
import { OperationDescription, TensorData } from '../model/APIData';
import { useNextBuffer } from '../hooks/useAPI';
import { toHex } from '../functions/math';
import ROUTES from '../definitions/routes';

interface BufferTableProps {
    tensor: TensorData;
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
        <table className={classNames('buffer-table arguments-table', className)}>
            <caption>Buffers</caption>

            <tbody>
                <tr>
                    <th>device_id</th>
                    <td>{tensor.device_id}</td>
                </tr>

                <tr>
                    <th>dtype</th>
                    <td>{tensor.dtype}</td>
                </tr>

                <tr>
                    <th>layout</th>
                    <td>{tensor.layout}</td>
                </tr>

                <tr>
                    <th>memory_config</th>
                    <td className='break-word'>{tensor.memory_config}</td>
                </tr>

                <tr>
                    <th>shape</th>
                    <td>{tensor.shape}</td>
                </tr>

                <tr>
                    <th>Last used</th>
                    <td>
                        Last used by{' '}
                        <Link to={`${ROUTES.OPERATIONS}/${lastOperation}`}>
                            {lastOperation} {operations.find((operation) => operation.id === lastOperation)?.name}
                        </Link>
                    </td>
                </tr>

                <tr>
                    <th>Deallocation</th>
                    <td>
                        {isLoading ? 'Loading...' : undefined}

                        {buffer && !isLoading && deallocationOperation ? (
                            <div>
                                Deallocation found in{' '}
                                <Link to={`${ROUTES.OPERATIONS}/${deallocationOperation}`}>
                                    {deallocationOperation}{' '}
                                    {
                                        operations.find(
                                            (operation) => operation.id === parseInt(deallocationOperation, 10),
                                        )?.name
                                    }
                                </Link>
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
                                        <Link to={`${ROUTES.OPERATIONS}/${buffer.operation_id}`}>
                                            {buffer.operation_id}{' '}
                                            {operations.find((operation) => operation.id === buffer.operation_id)?.name}
                                        </Link>{' '}
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
