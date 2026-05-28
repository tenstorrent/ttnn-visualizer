// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Link } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { BasicTensor } from '../../functions/parsePerfRowTensors';
import { toReadableLayout, toReadableShape, toReadableType } from '../../functions/formatting';
import { formatMemorySize, getMemoryAddress } from '../../functions/math';
import isValidNumber from '../../functions/isValidNumber';
import { OperationDescription, Tensor } from '../../model/APIData';
import { BufferType, BufferTypeLabel } from '../../model/BufferType';
import MemoryTag from '../MemoryTag';
import MemoryConfigRow from '../MemoryConfigRow';
import GoldenTensorComparisonIndicator from '../GoldenTensorComparisonIndicator';
import ROUTES from '../../definitions/Routes';
import { ShardSpec } from '../../functions/parseMemoryConfig';
import { showHexAtom } from '../../store/app';

interface PerfTensorRowBasicProps {
    mode: 'basic';
    basic: BasicTensor;
}

interface PerfTensorRowEnrichedProps {
    mode: 'enriched';
    tensor: Tensor;
    operations: OperationDescription[];
    label: string;
}

export type PerfTensorRowProps = PerfTensorRowBasicProps | PerfTensorRowEnrichedProps;

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

function PerfTensorRowBasic({ basic }: { basic: BasicTensor }) {
    return (
        <div className='perf-tensor-row perf-tensor-row-basic'>
            <h4 className='perf-tensor-row-title'>{basic.label}</h4>

            <dl className='perf-tensor-row-fields'>
                {basic.dtype ? (
                    <>
                        <dt>Dtype</dt>
                        <dd>{toReadableType(basic.dtype)}</dd>
                    </>
                ) : null}

                {basic.memory ? (
                    <>
                        <dt>Memory</dt>
                        <dd>{basic.memory}</dd>
                    </>
                ) : null}

                {basic.buffer_type !== null ? (
                    <>
                        <dt>Type</dt>
                        <dd>
                            <MemoryTag memory={BufferTypeLabel[basic.buffer_type]} />
                        </dd>
                    </>
                ) : null}

                {basic.layout ? (
                    <>
                        <dt>Layout</dt>
                        <dd>{basic.layout}</dd>
                    </>
                ) : null}
            </dl>
        </div>
    );
}

function PerfTensorRowEnriched({
    tensor,
    operations,
    label,
}: {
    tensor: Tensor;
    operations: OperationDescription[];
    label: string;
}) {
    const showHex = useAtomValue(showHexAtom);
    const firstProducerId = tensor.producers[0];

    return (
        <div className='perf-tensor-row perf-tensor-row-enriched'>
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
                                <MemoryTag memory={BufferTypeLabel[tensor.buffer_type as BufferType]} />
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
                            <td>{formatMemorySize(tensor.size ?? undefined)}</td>
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

function PerfTensorRow(props: PerfTensorRowProps) {
    const { mode } = props;

    if (mode === 'basic') {
        const { basic } = props;
        return <PerfTensorRowBasic basic={basic} />;
    }

    const { tensor, operations, label } = props;

    return (
        <PerfTensorRowEnriched
            tensor={tensor}
            operations={operations}
            label={label}
        />
    );
}

export default PerfTensorRow;
