// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { OperationDescription, Tensor } from '../model/APIData';
import { getMemoryAddress } from '../functions/math';
import { toReadableShape, toReadableType } from '../functions/formatting';
import ROUTES from '../definitions/Routes';
import 'styles/components/BufferDetails.scss';
import getDeallocationOperation from '../functions/getDeallocationOperation';
import getNextAllocationOperation from '../functions/getNextAllocationOperation';
import { getLastConsumerLink, getOperationLink } from '../functions/getOperationLink';
import isValidNumber from '../functions/isValidNumber';
import { ShardSpec } from '../functions/parseMemoryConfig';
import MemoryConfigRow from './MemoryConfigRow';
import GoldenTensorComparisonIndicator from './GoldenTensorComparisonIndicator';
import { showHexAtom } from '../store/app';

interface BufferDetailsProps {
    tensor: Tensor;
    operations: OperationDescription[];
    className?: string;
}

// TODO: The tensor-details table below largely duplicates the one in PerfTensorRow.tsx.
// Extract a shared TensorDetailsTable both can consume so the two don't drift.
function BufferDetails({ tensor, operations, className }: BufferDetailsProps) {
    const { address, dtype, layout, shape } = tensor;
    const firstOperationId = tensor.producers[0];
    const lastOperationId = tensor.consumers[tensor.consumers.length - 1];
    const deallocationOperationId = getDeallocationOperation(tensor, operations)?.id;
    const nextAllocationOperationId = getNextAllocationOperation(tensor, operations)?.id;

    const showHex = useAtomValue(showHexAtom);

    return (
        <>
            <table className='ttnn-table analysis-table'>
                <tbody>
                    <tr>
                        <th>Tensor Id</th>
                        <td>{tensor.id}</td>
                    </tr>

                    <tr>
                        <th>Producer</th>
                        <td>
                            {isValidNumber(firstOperationId)
                                ? getOperationLink(firstOperationId, operations)
                                : 'No producer for this tensor'}
                        </td>
                    </tr>

                    <tr>
                        <th>Last consumer</th>
                        <td>
                            {isValidNumber(lastOperationId)
                                ? getLastConsumerLink(tensor, operations)
                                : 'No consumers for this tensor'}
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
                                    {getMemoryAddress(address, showHex)} next allocated in{' '}
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
                        <th>Shape</th>
                        <td>{toReadableShape(shape)}</td>
                    </tr>

                    <tr>
                        <th>DataType</th>
                        <td>{toReadableType(dtype)}</td>
                    </tr>

                    <tr>
                        <th>Layout</th>
                        <td>{layout}</td>
                    </tr>

                    {tensor?.memory_config
                        ? Object.entries(tensor.memory_config).map(([key, value]) => (
                              <MemoryConfigRow
                                  key={key}
                                  header={key}
                                  value={value as string | ShardSpec}
                              />
                          ))
                        : null}

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

                            {tensor?.comparison?.global ? (
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
                            ) : null}
                        </>
                    ) : null}
                </tbody>
            </table>
        </>
    );
}

export default BufferDetails;
