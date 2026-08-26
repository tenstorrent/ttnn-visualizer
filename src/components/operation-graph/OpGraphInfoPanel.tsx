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
import { formatMemorySize, formatSize } from '../../functions/math';
import { extractOperationSourceData } from '../../functions/stackTraceSource';
import type { OperationDescription, Tensor } from '../../model/APIData';
import { BufferTypeLabel } from '../../model/BufferType';
import type { ShardSpec } from '../../model/MemoryConfig';
import MemoryConfigRow from '../MemoryConfigRow';
import MemoryTag from '../MemoryTag';
import SourceFileButton from '../operation-details/SourceFileButton';
import PerfOverlayOpMetric from '../perf-overlay/PerfOverlayOpMetric';
import { sumOptional } from './opGraphRepeatBlocks';
import type { OpGraphBlockSummary } from './opGraphTypes';

interface ConnectedOpGroup {
    key: string;
    label: string;
    operationId: number | null;
    tensors: Tensor[];
}

// Grouped by the op at the other end of the edge, so the panel reads as "who
// feeds me / who consumes me". A tensor with several appears under each.
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

const tensorBytes = (tensors: { size: number | null }[]): number =>
    tensors.reduce((total, tensor) => total + (tensor.size ?? 0), 0);

const uniqueNameCounts = (names: readonly string[]): Array<{ name: string; count: number }> => {
    const counts: Array<{ name: string; count: number }> = [];
    const indexByName = new Map<string, number>();
    for (const name of names) {
        const existing = indexByName.get(name);
        if (existing === undefined) {
            indexByName.set(name, counts.length);
            counts.push({ name, count: 1 });
        } else {
            counts[existing].count += 1;
        }
    }
    return counts;
};

const withExternalEndpoints = (tensor: Tensor, memberIds: ReadonlySet<number>, direction: NodeRelation): Tensor => {
    if (direction === NodeRelation.Input) {
        const producers = tensor.producers ?? [];
        const producerNames = tensor.producerNames ?? [];
        const keep = producers
            .map((id, index) => ({ id, name: producerNames[index] ?? '' }))
            .filter((entry) => !memberIds.has(entry.id));
        return { ...tensor, producers: keep.map((entry) => entry.id), producerNames: keep.map((entry) => entry.name) };
    }
    const consumers = tensor.consumers ?? [];
    const consumerNames = tensor.consumerNames ?? [];
    const keep = consumers
        .map((id, index) => ({ id, name: consumerNames[index] ?? '' }))
        .filter((entry) => !memberIds.has(entry.id));
    return { ...tensor, consumers: keep.map((entry) => entry.id), consumerNames: keep.map((entry) => entry.name) };
};

const getBlockBoundaryTensors = (
    members: OperationDescription[],
    memberIds: ReadonlySet<number>,
    direction: NodeRelation,
): Tensor[] => {
    const tensors: Tensor[] = [];
    const seenIds = new Set<number>();
    for (const member of members) {
        const list = (direction === NodeRelation.Input ? member.inputs : member.outputs) ?? [];
        for (const tensor of list) {
            if (!seenIds.has(tensor.id)) {
                const counterparts = (direction === NodeRelation.Input ? tensor.producers : tensor.consumers) ?? [];
                if (counterparts.length === 0 || counterparts.some((id) => !memberIds.has(id))) {
                    seenIds.add(tensor.id);
                    tensors.push(withExternalEndpoints(tensor, memberIds, direction));
                }
            }
        }
    }
    return tensors;
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

interface OpGraphBlockPanelProps {
    block: OpGraphBlockSummary;
    operationList: OperationDescription[];
    operationNamesById: Map<number, string>;
    onLocateOperation: (operationId: number) => void;
    isPerfOverlayActive: boolean;
    perfDeviceTimeNs?: number;
}

const OpGraphBlockPanel = ({
    block,
    operationList,
    operationNamesById,
    onLocateOperation,
    isPerfOverlayActive,
    perfDeviceTimeNs,
}: OpGraphBlockPanelProps) => {
    const memberIds = useMemo(() => new Set(block.operationIds), [block.operationIds]);
    const members = useMemo(
        () =>
            block.operationIds
                .map((id) => operationList.find((operation) => operation.id === id))
                .filter((operation): operation is OperationDescription => operation !== undefined),
        [block.operationIds, operationList],
    );
    const inputGroups = useMemo(
        () =>
            getConnectedOpGroups(
                getBlockBoundaryTensors(members, memberIds, NodeRelation.Input),
                NodeRelation.Input,
                operationNamesById,
            ),
        [members, memberIds, operationNamesById],
    );
    const outputGroups = useMemo(
        () =>
            getConnectedOpGroups(
                getBlockBoundaryTensors(members, memberIds, NodeRelation.Output),
                NodeRelation.Output,
                operationNamesById,
            ),
        [members, memberIds, operationNamesById],
    );
    const typeCounts = useMemo(() => uniqueNameCounts(members.map((member) => member.name)), [members]);
    const durationSeconds = sumOptional(members.map((member) => member.duration));
    const memoryDeltaBytes = sumOptional(
        members.map((member) => tensorBytes(member.outputs) - tensorBytes(member.inputs)),
    );
    const firstOpId = block.operationIds[0];
    const lastOpId = block.operationIds[block.operationIds.length - 1];
    const inputCount = inputGroups.reduce((total, group) => total + group.tensors.length, 0);
    const outputCount = outputGroups.reduce((total, group) => total + group.tensors.length, 0);
    const locateId = firstOpId;

    return (
        <aside
            className='op-graph-panel'
            aria-label='Selected block details'
        >
            <header className='op-graph-panel-header'>
                <div className='op-graph-panel-titles'>
                    <h2 className='op-graph-panel-label'>{block.label}</h2>
                    <p className='op-graph-panel-id'>
                        {`ops ${firstOpId}–${lastOpId} · instance ${block.instanceIndex + 1} of ${block.instanceCount}`}
                    </p>
                </div>
                {locateId !== undefined && (
                    <div className='op-graph-panel-actions'>
                        <Tooltip
                            content='Recenter'
                            compact
                        >
                            <Button
                                icon={IconNames.LOCATE}
                                size={Size.SMALL}
                                variant={ButtonVariant.MINIMAL}
                                onClick={() => onLocateOperation(locateId)}
                                aria-label={`Recenter on ${block.label}`}
                            />
                        </Tooltip>
                    </div>
                )}
            </header>

            <dl className='op-graph-panel-stats'>
                <dt>Operations</dt>
                <dd>{block.operationIds.length}</dd>
                {durationSeconds > 0 ? (
                    <>
                        <dt>Python duration</dt>
                        <dd>{`${formatSize(durationSeconds, 2)} s`}</dd>
                    </>
                ) : null}
                {memoryDeltaBytes !== 0 ? (
                    <>
                        <dt>Memory delta</dt>
                        <dd>
                            {`${memoryDeltaBytes > 0 ? '+' : '-'}${formatMemorySize(Math.abs(memoryDeltaBytes), 0)}`}
                        </dd>
                    </>
                ) : null}
            </dl>

            {isPerfOverlayActive ? <PerfOverlayOpMetric perfDeviceTimeNs={perfDeviceTimeNs} /> : null}

            <PanelSection
                title='Operation types'
                count={typeCounts.length}
                emptyHint='No operations in this instance.'
            >
                <ul className='op-graph-panel-device-ops'>
                    {typeCounts.map((entry) => (
                        <li key={entry.name}>{entry.count > 1 ? `${entry.name} × ${entry.count}` : entry.name}</li>
                    ))}
                </ul>
            </PanelSection>

            <PanelSection
                title='Inputs'
                count={inputCount}
                emptyHint='No tensors enter this instance.'
                modifierClass='op-graph-panel-inputs'
            >
                <ConnectedOpGroupList
                    groups={inputGroups}
                    keyPrefix={`block-input-${block.instanceId}`}
                    onLocate={onLocateOperation}
                />
            </PanelSection>

            <PanelSection
                title='Outputs'
                count={outputCount}
                emptyHint='No tensors leave this instance.'
                modifierClass='op-graph-panel-outputs'
            >
                <ConnectedOpGroupList
                    groups={outputGroups}
                    keyPrefix={`block-output-${block.instanceId}`}
                    onLocate={onLocateOperation}
                />
            </PanelSection>
        </aside>
    );
};

interface OpGraphInfoPanelProps {
    operationId: number;
    operationList: OperationDescription[];
    operationNamesById: Map<number, string>;
    onLocateOperation: (operationId: number) => void;
    isPerfOverlayActive: boolean;
    perfDeviceTimeNs?: number;
    perfColor?: string;
    block?: OpGraphBlockSummary | null;
}

// Node drag re-renders the graph every pointer frame, and re-rendering each
// tensor's memory-config table with it stutters. Every prop must be stable.
const OpGraphInfoPanel = memo(
    ({
        operationId,
        operationList,
        operationNamesById,
        onLocateOperation,
        isPerfOverlayActive,
        perfDeviceTimeNs,
        perfColor,
        block = null,
    }: OpGraphInfoPanelProps) => {
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

        if (block !== null) {
            return (
                <OpGraphBlockPanel
                    block={block}
                    operationList={operationList}
                    operationNamesById={operationNamesById}
                    onLocateOperation={onLocateOperation}
                    isPerfOverlayActive={isPerfOverlayActive}
                    perfDeviceTimeNs={perfDeviceTimeNs}
                />
            );
        }

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

                {isPerfOverlayActive ? (
                    <PerfOverlayOpMetric
                        perfDeviceTimeNs={perfDeviceTimeNs}
                        perfColor={perfColor}
                    />
                ) : null}

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
