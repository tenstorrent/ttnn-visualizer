// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { OperationDescription, TensorData } from '../model/APIData';
import { toHex } from '../functions/math';
import ROUTES from '../definitions/routes';
import 'styles/components/BufferDetails.scss';
import getDeallocationOperation from '../functions/getDeallocationOperation';
import getNextAllocationOperation from '../functions/getNextAllocationOperation';
import { Operation, Tensor } from '../model/Graph';
import isValidNumber from '../functions/isValidNumber';
import parseMemoryConfig, { ShardSpec } from '../functions/parseMemoryConfig';
import MemoryConfigRow from './MemoryConfigRow';
import GoldenTensorComparisonIndicator from './GoldenTensorComparisonIndicator';

interface BufferDetailsProps {
    tensor: TensorData;
    operations: OperationDescription[];
    className?: string;
}

function BufferDetails({ tensor, operations, className }: BufferDetailsProps) {
    const { address, dtype, layout, shape } = tensor;
    const lastOperationId: number = tensor.consumers[tensor.consumers.length - 1];
    const deallocationOperationId = getDeallocationOperation(tensor, operations)?.id;
    const nextAllocationOperationId = getNextAllocationOperation(tensor, operations)?.id;

    return (
        <>
            <table className='ttnn-table analysis-table'>
                <tbody>
                    <tr>
                        <th>Last used</th>
                        <td>
                            {isValidNumber(lastOperationId)
                                ? getLastOperation(lastOperationId, operations, tensor)
                                : 'No consumers for this tensor'}
                        </td>
                    </tr>

                    <tr>
                        <th>Deallocation</th>
                        <td>
                            {isValidNumber(deallocationOperationId) ? (
                                <div>
                                    Deallocation found in{' '}
                                    <Link to={`${ROUTES.OPERATIONS}/${deallocationOperationId}`}>
                                        {deallocationOperationId}{' '}
                                        {operations.find((operation) => operation.id === deallocationOperationId)?.name}
                                    </Link>
                                    <Icon
                                        className='deallocation-icon'
                                        icon={IconNames.TICK}
                                        intent={Intent.SUCCESS}
                                    />
                                </div>
                            ) : (
                                <>
                                    Missing deallocation operation
                                    <Icon
                                        className='deallocation-icon'
                                        icon={IconNames.WARNING_SIGN}
                                        intent={Intent.WARNING}
                                    />
                                </>
                            )}
                        </td>
                    </tr>

                    {/* This is stupid but Typescript is complaining otherwise */}
                    {isValidNumber(nextAllocationOperationId) &&
                    isValidNumber(deallocationOperationId) &&
                    isValidNumber(address) ? (
                        <tr>
                            <th>Next allocation</th>
                            <td>
                                <span>
                                    {toHex(address)} next allocated in{' '}
                                    <Link to={`${ROUTES.OPERATIONS}/${nextAllocationOperationId}`}>
                                        {nextAllocationOperationId}{' '}
                                        {
                                            operations.find((operation) => operation.id === nextAllocationOperationId)
                                                ?.name
                                        }
                                    </Link>{' '}
                                    (+{nextAllocationOperationId - deallocationOperationId} operations)
                                </span>
                            </td>
                        </tr>
                    ) : null}
                </tbody>
            </table>

            <table className={classNames('ttnn-table two-tone-rows buffer-table', className)}>
                <tbody>
                    <tr>
                        <th>Device Id</th>
                        <td>{tensor.device_id ?? 'n/a'}</td>
                    </tr>

                    <tr>
                        <th>DataType</th>
                        <td>{dtype}</td>
                    </tr>

                    <tr>
                        <th>Layout</th>
                        <td>{layout}</td>
                    </tr>

                    {tensor?.memory_config
                        ? Object.entries(parseMemoryConfig(tensor.memory_config)).map(([key, value]) => (
                              <MemoryConfigRow
                                  key={key}
                                  header={key}
                                  value={value as string | ShardSpec}
                              />
                          ))
                        : null}

                    <tr>
                        <th>Shape</th>
                        <td>{shape}</td>
                    </tr>

                    {tensor.comparison ? (
                        <>
                            <tr>
                                <th>Matches Locally</th>
                                <td>
                                    <GoldenTensorComparisonIndicator
                                        value={tensor.comparison.local.actual_pcc}
                                        label='Actual PCC:'
                                    />
                                    <GoldenTensorComparisonIndicator
                                        value={tensor.comparison.local.desired_pcc}
                                        label='Desired PCC:'
                                    />
                                </td>
                            </tr>

                            <tr>
                                <th>Matches Globally</th>
                                <td>
                                    <GoldenTensorComparisonIndicator
                                        value={tensor.comparison.global.actual_pcc}
                                        label='Actual PCC:'
                                    />
                                    <GoldenTensorComparisonIndicator
                                        value={tensor.comparison.global.desired_pcc}
                                        label='Desired PCC:'
                                    />
                                </td>
                            </tr>
                        </>
                    ) : null}
                </tbody>
            </table>
        </>
    );
}

function getLastOperation(lastOperationId: number, operations: Operation[], tensor: Tensor) {
    let lastOperation = operations.find((operation) => operation.id === lastOperationId);

    if (lastOperation?.name.includes('deallocate') && tensor.consumers.length > 1) {
        lastOperation = operations.find((operation) => operation.id === tensor.consumers[tensor.consumers.length - 2]);
    }

    return lastOperation ? (
        <Link to={`${ROUTES.OPERATIONS}/${lastOperation.id}`}>
            {lastOperation?.id} {lastOperation.name}
        </Link>
    ) : null;
}

export default BufferDetails;
