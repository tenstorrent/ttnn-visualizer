// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent, PopoverPosition, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { type ReactNode, memo, useMemo } from 'react';
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
    <div className='op-graph-panel-tensor'>
        <div className='op-graph-panel-tensor-header'>
            {tensor.buffer_type !== null && <MemoryTag memory={BufferTypeLabel[tensor.buffer_type]} />}
            <span className='op-graph-panel-tensor-shape'>{toReadableShape(tensor.shape)}</span>
            <span className='op-graph-panel-tensor-id'>Tensor {tensor.id}</span>
        </div>
        <div className='op-graph-panel-tensor-meta'>
            <span>{toReadableType(tensor.dtype)}</span>
            <span>{tensor.layout}</span>
        </div>
        {tensor.operationIdentifier ? (
            <div className='op-graph-panel-tensor-source'>{tensor.operationIdentifier}</div>
        ) : null}
        {tensor.memory_config
            ? Object.entries(tensor.memory_config).map(([key, value]) => (
                  <table
                      className='op-graph-panel-memory-config'
                      key={key}
                  >
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

interface PanelSectionProps {
    title: string;
    count: number;
    emptyHint: string;
    modifierClass?: string;
    children: ReactNode;
}

const PanelSection = ({ title, count, emptyHint, modifierClass, children }: PanelSectionProps) => (
    <section className={`op-graph-panel-section ${modifierClass ?? ''}`.trim()}>
        <div className='op-graph-panel-section-header'>
            <span className='op-graph-panel-section-title'>{title}</span>
            <span className='op-graph-panel-section-count'>{count}</span>
        </div>
        <div className='op-graph-panel-section-body'>
            {count === 0 ? <p className='op-graph-panel-empty'>{emptyHint}</p> : children}
        </div>
    </section>
);

interface ConnectedOpGroupListProps {
    groups: ConnectedOpGroup[];
    keyPrefix: string;
    onLocate: (operationId: number) => void;
}

const ConnectedOpGroupList = ({ groups, keyPrefix, onLocate }: ConnectedOpGroupListProps) => (
    <div className='op-graph-panel-groups'>
        {groups.map((group) => (
            <div
                className='op-graph-panel-group'
                key={`${keyPrefix}-${group.key}`}
            >
                <div className='op-graph-panel-group-header'>
                    <span className='op-graph-panel-group-label'>{group.label}</span>
                    {group.operationId !== null && (
                        <Tooltip
                            placement={PopoverPosition.LEFT}
                            content={`Locate operation ${group.operationId} in graph`}
                            compact
                        >
                            <Button
                                className='op-graph-panel-locate'
                                icon={IconNames.LOCATE}
                                size={Size.SMALL}
                                variant={ButtonVariant.MINIMAL}
                                onClick={() => onLocate(group.operationId as number)}
                                aria-label={`Locate operation ${group.operationId} in graph`}
                            />
                        </Tooltip>
                    )}
                </div>
                {group.tensors.map((tensor, index) => (
                    <TensorDetails
                        tensor={tensor}
                        key={`${keyPrefix}-${group.key}-${tensor.id}-${index}`}
                    />
                ))}
            </div>
        ))}
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

        const deviceOperationNames = operation?.deviceOperationNameList ?? [];

        return (
            <aside
                className='op-graph-panel'
                aria-label='Selected operation details'
            >
                <header className='op-graph-panel-header'>
                    <div className='op-graph-panel-titles'>
                        <h2 className='op-graph-panel-label'>
                            {operationId} {operation?.name}
                        </h2>
                        <p
                            className='op-graph-panel-id'
                            title={operation?.operationFileIdentifier}
                        >
                            {operation?.operationFileIdentifier}
                        </p>
                    </div>
                    <div className='op-graph-panel-actions'>
                        <Tooltip
                            content='Recenter'
                            compact
                        >
                            <Button
                                icon={IconNames.LOCATE}
                                size={Size.SMALL}
                                variant={ButtonVariant.MINIMAL}
                                onClick={() => onLocateOperation(operationId)}
                                aria-label={`Recenter on operation ${operationId}`}
                            />
                        </Tooltip>
                    </div>
                </header>

                <div className='op-graph-panel-links'>
                    <Button
                        endIcon={IconNames.SEGMENTED_CONTROL}
                        size={Size.SMALL}
                        intent={Intent.PRIMARY}
                        onClick={() => navigate(`${ROUTES.OPERATIONS}/${operationId}`)}
                    >
                        Memory Details
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

                <PanelSection
                    title='Device operations'
                    count={deviceOperationNames.length}
                    emptyHint='No device operations.'
                >
                    <ul className='op-graph-panel-device-ops'>
                        {deviceOperationNames.map((deviceOp, index) => (
                            <li key={`device-op-${index}`}>{deviceOp}()</li>
                        ))}
                    </ul>
                </PanelSection>

                <PanelSection
                    title='Inputs'
                    count={operation?.inputs.length ?? 0}
                    emptyHint='No inputs.'
                    modifierClass='op-graph-panel-inputs'
                >
                    <ConnectedOpGroupList
                        groups={inputGroups}
                        keyPrefix={`input-${operationId}`}
                        onLocate={onLocateOperation}
                    />
                </PanelSection>

                <PanelSection
                    title='Outputs'
                    count={operation?.outputs.length ?? 0}
                    emptyHint='No outputs.'
                    modifierClass='op-graph-panel-outputs'
                >
                    <ConnectedOpGroupList
                        groups={outputGroups}
                        keyPrefix={`output-${operationId}`}
                        onLocate={onLocateOperation}
                    />
                </PanelSection>
            </aside>
        );
    },
);

OpGraphInfoPanel.displayName = 'OpGraphInfoPanel';

export default OpGraphInfoPanel;
