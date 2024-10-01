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

interface BufferDetailsProps {
    tensor: TensorData;
    operations: OperationDescription[];
    className?: string;
}

interface ShardSpec {
    grid: string;
    shape: [number, number];
    orientation: string;
    halo: number;
}

const HEADER_LABELS = {
    shard_spec: 'ShardSpec',
    memory_layout: 'MemoryLayout',
    grid: 'CoreRangeSet',
    shape: 'Shape',
    orientation: 'ShardOrientation',
    halo: 'Halo',
};

function BufferDetails({ tensor, operations, className }: BufferDetailsProps) {
    const { address, dtype, layout, shape } = tensor;
    const lastOperationId: number = tensor.consumers[tensor.consumers.length - 1];
    const deallocationOperationId = getDeallocationOperation(tensor, operations);
    const allocationOperationId = getNextAllocationOperation(tensor, operations);

    return (
        <>
            <table className='ttnn-table analysis-table'>
                <tbody>
                    <tr>
                        <th>Last used</th>
                        <td>
                            {lastOperationId
                                ? getLastOperation(lastOperationId, operations, tensor)
                                : 'No consumers for this tensor'}
                        </td>
                    </tr>

                    <tr>
                        <th>Deallocation</th>
                        <td>
                            {Number.isFinite(deallocationOperationId) ? (
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

                    {allocationOperationId && deallocationOperationId && address ? (
                        <tr>
                            <th>Next allocation</th>
                            <td>
                                <span>
                                    {toHex(address)} next allocated in{' '}
                                    <Link to={`${ROUTES.OPERATIONS}/${allocationOperationId}`}>
                                        {allocationOperationId}{' '}
                                        {operations.find((operation) => operation.id === allocationOperationId)?.name}
                                    </Link>{' '}
                                    (+{allocationOperationId - deallocationOperationId} operations)
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
                              <tr key={key}>
                                  {key === 'shard_spec' && value && typeof value !== 'string' ? (
                                      <>
                                          <th>{getHeaderLabel(key)}</th>
                                          <td>
                                              <table className='ttnn-table alt-two-tone-rows'>
                                                  <tbody>
                                                      {Object.entries(value as ShardSpec).map(
                                                          ([innerKey, innerValue]) => (
                                                              <tr key={innerKey}>
                                                                  <th>
                                                                      {getHeaderLabel(
                                                                          innerKey as keyof typeof HEADER_LABELS,
                                                                      )}
                                                                  </th>
                                                                  <td>{innerValue}</td>
                                                              </tr>
                                                          ),
                                                      )}
                                                  </tbody>
                                              </table>
                                          </td>
                                      </>
                                  ) : (
                                      <>
                                          <th>{getHeaderLabel(key as keyof typeof HEADER_LABELS)}</th>
                                          <td>{value as string}</td>
                                      </>
                                  )}
                              </tr>
                          ))
                        : null}

                    <tr>
                        <th>Shape</th>
                        <td>{shape}</td>
                    </tr>
                </tbody>
            </table>
        </>
    );
}

function parseMemoryConfig(string: string) {
    const regex = /MemoryConfig\((.*)\)$/;
    const match = string.match(regex);

    if (match) {
        const capturedString = match[1];

        const memoryLayoutPattern = /memory_layout=([A-Za-z_:]+)/;
        const shardSpecPattern =
            /shard_spec=ShardSpec\(grid=\{(\[.*?\])\},shape=\{(\d+),\s*(\d+)\},orientation=ShardOrientation::([A-Z_]+),halo=(\d+)\)/;

        const memoryLayoutMatch = capturedString.match(memoryLayoutPattern);
        const shardSpecMatch = capturedString.match(shardSpecPattern);

        const memoryLayout = memoryLayoutMatch ? memoryLayoutMatch[1] : null;
        const shardSpec = shardSpecMatch
            ? {
                  grid: shardSpecMatch[1],
                  shape: [parseInt(shardSpecMatch[2], 10), parseInt(shardSpecMatch[3], 10)],
                  orientation: shardSpecMatch[4],
                  halo: parseInt(shardSpecMatch[5], 10),
              }
            : null;

        return {
            memory_layout: memoryLayout,
            shard_spec: shardSpec || 'std::nullopt',
        };
    }

    return string;
}

function getHeaderLabel(key: keyof typeof HEADER_LABELS) {
    return HEADER_LABELS[key];
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
