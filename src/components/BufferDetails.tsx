// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { Tensor } from '../model/Graph';
import { OperationDescription, TensorData } from '../model/APIData';
import { toHex } from '../functions/math';
import ROUTES from '../definitions/routes';
import { useNextBuffer } from '../hooks/useAPI';
import 'styles/components/BufferDetails.scss';

interface BufferDetailsProps {
    tensor: TensorData;
    operations: OperationDescription[];
    queryKey: string;
    className?: string;
}

interface ShardSpec {
    grid: string;
    shape: [number, number];
    orientation: string;
    halo: number;
}

const TH_LABELS = {
    shard_spec: 'ShardSpec',
    memory_layout: 'MemoryLayout',
    grid: 'CoreRangeSet',
    shape: 'Shape',
    orientation: 'ShardOrientation',
    halo: 'Halo',
};

function BufferDetails({ tensor, operations, queryKey, className }: BufferDetailsProps) {
    const { address, consumers, dtype, layout, shape } = tensor;
    const lastOperation = tensor.consumers[tensor.consumers.length - 1];
    const deallocationOperation = getDeallocation(tensor, operations);
    const { data: buffer, isLoading } = useNextBuffer(address, consumers, queryKey);

    return (
        <>
            <table className='ttnn-table analysis-table'>
                <tbody>
                    <tr>
                        <th>Last used</th>
                        <td>
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

                    {buffer?.next_usage && address && !isLoading ? (
                        <tr>
                            <th>Next allocation</th>
                            <td>
                                <span>
                                    {toHex(address)} next allocated in{' '}
                                    <Link to={`${ROUTES.OPERATIONS}/${buffer.operation_id}`}>
                                        {buffer.operation_id}{' '}
                                        {operations.find((operation) => operation.id === buffer.operation_id)?.name}
                                    </Link>{' '}
                                    (+{buffer.next_usage} operations)
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
                                          <th>{getThLabel(key)}</th>
                                          <td>
                                              <table className='ttnn-table alt-two-tone-rows'>
                                                  <tbody>
                                                      {Object.entries(value as ShardSpec).map(
                                                          ([innerKey, innerValue]) => (
                                                              <tr key={innerKey}>
                                                                  <th>
                                                                      {getThLabel(innerKey as keyof typeof TH_LABELS)}
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
                                          <th>{getThLabel(key as keyof typeof TH_LABELS)}</th>
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

function getDeallocation(tensor: Tensor, operations: OperationDescription[]) {
    // TODO: Maybe we can strengthen this logic to ensure we're looking at deallocations rather than just checking the name
    const matchingInputs = operations.filter(
        (operation) =>
            operation.name.includes('deallocate') && operation.inputs.find((input) => input.id === tensor.id),
    );

    return matchingInputs.map((x) => x.id).toString();
}

function parseMemoryConfig(string: string) {
    const regex = /MemoryConfig\((.*)\)$/;
    const match = string.match(regex);

    if (match) {
        const capturedString = match[1];

        const memoryLayoutPattern = /memory_layout=([A-Za-z_:]+)/;
        const shardSpecPattern =
            /shard_spec=ShardSpec\(grid=\{(\[.*?\])\},shape=\{(\d+),\s*(\d+)\},orientation=ShardOrientation::([A-Z_]+),halo=(\d+)\)/;

        // Extracting the values using regular expressions
        const memoryLayoutMatch = capturedString.match(memoryLayoutPattern);
        const shardSpecMatch = capturedString.match(shardSpecPattern);

        // Assign values if the matches are found
        const memoryLayout = memoryLayoutMatch ? memoryLayoutMatch[1] : null;
        const shardSpec = shardSpecMatch
            ? {
                  grid: shardSpecMatch[1],
                  shape: [parseInt(shardSpecMatch[2], 10), parseInt(shardSpecMatch[3], 10)],
                  orientation: shardSpecMatch[4],
                  halo: parseInt(shardSpecMatch[5], 10),
              }
            : null;

        // console.log('shardSpec', shardSpecMatch);

        // Return the result as a JSON object
        return {
            memory_layout: memoryLayout,
            shard_spec: shardSpec || 'std::nullopt',
        };
    }

    return string;
}

function getThLabel(key: keyof typeof TH_LABELS) {
    return TH_LABELS[key];
}

export default BufferDetails;
