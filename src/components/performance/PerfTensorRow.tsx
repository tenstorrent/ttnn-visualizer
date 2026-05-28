// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { Link } from 'react-router-dom';
import ROUTES from '../../definitions/Routes';
import { toReadableLayout, toReadableShape, toReadableType } from '../../functions/formatting';
import isValidNumber from '../../functions/isValidNumber';
import { formatMemorySize, getMemoryAddress } from '../../functions/math';
import { ShardSpec } from '../../functions/parseMemoryConfig';
import { OperationDescription, Tensor } from '../../model/APIData';
import { BufferTypeLabel } from '../../model/BufferType';
import { showHexAtom } from '../../store/app';
import GoldenTensorComparisonIndicator from '../GoldenTensorComparisonIndicator';
import MemoryConfigRow from '../MemoryConfigRow';
import MemoryTag from '../MemoryTag';

export interface PerfTensorRowProps {
    tensor: Tensor;
    operations: OperationDescription[];
    label: string;
}

function getOperationLink(operationId: number, operations: OperationDescription[]) {
    const operation = operations.find((entry) => entry.id === operationId);

    if (!operation) {
        return null;
    }

    return (
        <Link to={`${ROUTES.OPERATIONS}/${operation.id}`}>
            {operation.id} {operation.name} ({operation.operationFileIdentifier})
        </Link>
    );
}

function getLastConsumerLink(tensor: Tensor, operations: OperationDescription[]) {
    const lastOperationId = tensor.consumers[tensor.consumers.length - 1];

    if (!isValidNumber(lastOperationId)) {
        return 'No consumers for this tensor';
    }

    let operation = operations.find((entry) => entry.id === lastOperationId);

    if (operation?.name.includes('deallocate') && tensor.consumers.length > 1) {
        operation = operations.find((entry) => entry.id === tensor.consumers[tensor.consumers.length - 2]);
    }

    return operation ? getOperationLink(operation.id, operations) : null;
}

function PerfTensorRow({ tensor, operations, label }: PerfTensorRowProps) {
    const showHex = useAtomValue(showHexAtom);
    const firstProducerId = tensor.producers[0];

    return (
        <div className='perf-tensor-row'>
            <h4 className='perf-tensor-row-title'>{label}</h4>

            <table className='ttnn-table two-tone-rows perf-tensor-row-table'>
                <tbody>
                    <tr>
                        <th>Tensor Id</th>
                        <td>{tensor.id}</td>
                    </tr>

                    <tr>
                        <th>Producer</th>
                        <td>
                            {isValidNumber(firstProducerId)
                                ? getOperationLink(firstProducerId, operations)
                                : 'No producer for this tensor'}
                        </td>
                    </tr>

                    <tr>
                        <th>Last consumer</th>
                        <td>{getLastConsumerLink(tensor, operations)}</td>
                    </tr>

                    <tr>
                        <th>Device Id</th>
                        <td>{tensor.device_id ?? 'n/a'}</td>
                    </tr>

                    <tr>
                        <th>Shape</th>
                        <td>{toReadableShape(tensor.shape)}</td>
                    </tr>

                    <tr>
                        <th>Dtype</th>
                        <td>{toReadableType(tensor.dtype)}</td>
                    </tr>

                    <tr>
                        <th>Layout</th>
                        <td>{toReadableLayout(tensor.layout)}</td>
                    </tr>

                    {tensor.buffer_type !== null ? (
                        <tr>
                            <th>Type</th>
                            <td>
                                <MemoryTag memory={BufferTypeLabel[tensor.buffer_type]} />
                            </td>
                        </tr>
                    ) : null}

                    {isValidNumber(tensor.address) ? (
                        <tr>
                            <th>Address</th>
                            <td>{getMemoryAddress(tensor.address, showHex)}</td>
                        </tr>
                    ) : null}

                    {tensor.size !== null ? (
                        <tr>
                            <th>Size</th>
                            <td>{formatMemorySize(tensor.size)}</td>
                        </tr>
                    ) : null}

                    {tensor.memory_config
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

                            {tensor.comparison.global ? (
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
        </div>
    );
}

export default PerfTensorRow;
