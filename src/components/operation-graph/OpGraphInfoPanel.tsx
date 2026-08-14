// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { memo, useMemo } from 'react';
import { useNavigate } from 'react-router';

import { NodeRelation } from '../../definitions/NodeRelation';
import ROUTES from '../../definitions/Routes';
import { StackTraceLanguage } from '../../definitions/StackTrace';
import { toReadableShape, toReadableType } from '../../functions/formatting';
import { extractOperationSourceData } from '../../functions/stackTraceSource';
import type { OperationDescription, Tensor } from '../../model/APIData';
import { BufferTypeLabel } from '../../model/BufferType';
import type { ShardSpec } from '../../model/MemoryConfig';
import MemoryConfigRow from '../MemoryConfigRow';
import MemoryTag from '../MemoryTag';
import SourceFileButton from '../operation-details/SourceFileButton';

interface ConnectedOpGroup {
    key: string;
    label: string;
    operationId: number | null;
    tensors: Tensor[];
}

// Tensors are grouped by the op on the other end of the edge so the panel reads
// as "who feeds me / who consumes me" rather than a flat tensor list. A tensor
// with several producers or consumers appears under each of them.
const getConnectedOpGroups = (
    tensors: Tensor[] | undefined,
    direction: NodeRelation,
    operationNamesById: Map<number, string>,
): ConnectedOpGroup[] => {
    if (!tensors?.length) {
        return [];
    }

    const groupsByKey = new Map<string, ConnectedOpGroup>();

    tensors.forEach((tensor) => {
        const ids = direction === NodeRelation.Input ? tensor.producers : tensor.consumers;
        const names = direction === NodeRelation.Input ? tensor.producerNames : tensor.consumerNames;

        if (!ids.length) {
            const key = direction === NodeRelation.Input ? 'external-input' : 'external-output';
            const label = direction === NodeRelation.Input ? 'External input' : 'Unconsumed output';
            const group = groupsByKey.get(key) ?? { key, label, operationId: null, tensors: [] };
            group.tensors.push(tensor);
            groupsByKey.set(key, group);
            return;
        }

        ids.forEach((operationId, index) => {
            const key = String(operationId);
            const name = operationNamesById.get(operationId) ?? names[index] ?? '';
            const group = groupsByKey.get(key) ?? {
                key,
                label: `${operationId} ${name}`.trim(),
                operationId,
                tensors: [],
            };
            group.tensors.push(tensor);
            groupsByKey.set(key, group);
        });
    });

    return Array.from(groupsByKey.values());
};

interface TensorDetailsProps {
    tensor: Tensor;
}

const TensorDetails = ({ tensor }: TensorDetailsProps) => (
    <div className='tensor-details'>
        <h3 className='tensor-header'>
            <span>{tensor.buffer_type !== null && <MemoryTag memory={BufferTypeLabel[tensor.buffer_type]} />}</span>{' '}
            {toReadableShape(tensor.shape)} Tensor {tensor.id}{' '}
        </h3>

        <div>{toReadableType(tensor.dtype)}</div>
        <div>{tensor.layout}</div>
        <div>{tensor.operationIdentifier}</div>
        {tensor.memory_config
            ? Object.entries(tensor.memory_config).map(([key, value]) => (
                  <table key={key}>
                      <tbody>
                          <MemoryConfigRow
                              header={key}
                              value={value as string | ShardSpec}
                          />
                      </tbody>
                  </table>
              ))
            : null}
    </div>
);

interface ConnectedOpHeaderProps {
    group: ConnectedOpGroup;
    onLocate: (operationId: number) => void;
}

const ConnectedOpHeader = ({ group, onLocate }: ConnectedOpHeaderProps) => (
    <div className='connected-op-header'>
        <h2 className='connected-op-name'>{group.label}</h2>
        {group.operationId !== null && (
            <Tooltip
                placement={PopoverPosition.RIGHT}
                content={`Locate operation ${group.operationId} in graph`}
            >
                <Button
                    className='connected-op-select'
                    icon={IconNames.LOCATE}
                    variant={ButtonVariant.MINIMAL}
                    onClick={() => onLocate(group.operationId as number)}
                    aria-label={`Locate operation ${group.operationId} in graph`}
                />
            </Tooltip>
        )}
    </div>
);

interface OpGraphInfoPanelProps {
    operationId: number;
    operationList: OperationDescription[];
    operationNamesById: Map<number, string>;
    onLocateOperation: (operationId: number) => void;
}

// Memoized because dragging a node re-renders the graph on every pointer frame,
// and re-rendering every tensor's memory-config table alongside it is enough to
// make the drag stutter. Callers must keep all four props referentially stable.
const OpGraphInfoPanel = memo(
    ({ operationId, operationList, operationNamesById, onLocateOperation }: OpGraphInfoPanelProps) => {
        const navigate = useNavigate();
        const operation = operationList.find((op) => op.id === operationId);
        const operationSourceData = operation ? extractOperationSourceData(operation) : null;

        const inputGroups = useMemo(
            () => getConnectedOpGroups(operation?.inputs, NodeRelation.Input, operationNamesById),
            [operation, operationNamesById],
        );
        const outputGroups = useMemo(
            () => getConnectedOpGroups(operation?.outputs, NodeRelation.Output, operationNamesById),
            [operation, operationNamesById],
        );

        return (
            <div className='operation-graph-props'>
                <h2 className='operation-name'>
                    {operationId} {operation?.name} ({operation?.operationFileIdentifier})
                </h2>
                <ul className='device-operation-list'>
                    {operation?.deviceOperationNameList.map((deviceOp, index) => (
                        <li key={`device-op-${index}`}>{deviceOp}()</li>
                    ))}
                </ul>
                <div className='operation-actions'>
                    <Button
                        className='navigate-button'
                        endIcon={IconNames.SEGMENTED_CONTROL}
                        intent={Intent.PRIMARY}
                        onClick={() => navigate(`${ROUTES.OPERATIONS}/${operationId}`)}
                    >
                        Memory Details
                    </Button>

                    <Button
                        className='recenter-button'
                        icon={IconNames.LOCATE}
                        intent={Intent.PRIMARY}
                        onClick={() => onLocateOperation(operationId)}
                        aria-label={`Recenter on operation ${operationId}`}
                    >
                        Locate {operationId}
                    </Button>

                    {operationSourceData && operation && (
                        <SourceFileButton
                            filePath={operationSourceData.filePath}
                            sourceFileId={operation.stack_trace_source_file_id}
                            lineNumber={operationSourceData.lineNumber}
                            language={StackTraceLanguage.PYTHON}
                            variant={ButtonVariant.OUTLINED}
                            ariaLabel={`View source for operation ${operation.id} ${operation.name}`}
                            eagerProbe
                        />
                    )}
                </div>

                <h3 className='inputs'>Inputs:</h3>
                <div className='inputs tensors'>
                    {inputGroups.map((group) => (
                        <div
                            className='connected-op'
                            key={`input-op-${operationId}-${group.key}`}
                        >
                            <ConnectedOpHeader
                                group={group}
                                onLocate={onLocateOperation}
                            />
                            {group.tensors.map((tensor, index) => (
                                <TensorDetails
                                    tensor={tensor}
                                    key={`input-${operationId}-${group.key}-${tensor.id}-${index}`}
                                />
                            ))}
                        </div>
                    ))}
                </div>
                <h3 className='outputs'>Outputs:</h3>
                <div className='outputs tensors'>
                    {outputGroups.map((group) => (
                        <div
                            className='connected-op'
                            key={`output-op-${operationId}-${group.key}`}
                        >
                            <ConnectedOpHeader
                                group={group}
                                onLocate={onLocateOperation}
                            />
                            {group.tensors.map((tensor, index) => (
                                <TensorDetails
                                    tensor={tensor}
                                    key={`output-${operationId}-${group.key}-${tensor.id}-${index}`}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        );
    },
);

OpGraphInfoPanel.displayName = 'OpGraphInfoPanel';

export default OpGraphInfoPanel;
