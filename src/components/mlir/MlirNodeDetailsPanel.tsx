// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type ReactNode, useMemo } from 'react';
import { useAtom } from 'jotai';
import { Button, ButtonVariant, Collapse, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import 'styles/components/MlirNodeDetailsPanel.scss';
import classNames from 'classnames';
import type { IncomingEdgeView, IndexedPortMetadata, OutgoingEdge, SourceNode } from './mlirGraphTypes';
import MlirAttrValue from './MlirAttrValue';
import { mlirNodeDetailsCollapsedAtom } from '../../store/app';

interface MlirNodeDetailsPanelProps {
    node: SourceNode;
    incomingEdges: IncomingEdgeView[];
    outgoingEdges: OutgoingEdge[];
    onClose: () => void;
    onRecenter: () => void;
}

interface OutputPortView {
    portId: string;
    metadata: IndexedPortMetadata | null;
    consumers: OutgoingEdge[];
}

type SectionKey = 'attrs' | 'inputs' | 'outputs';

interface DetailsSectionProps {
    title: string;
    sectionKey: SectionKey;
    collapsed: boolean;
    onToggle: (key: SectionKey) => void;
    emptyHint: string;
    isEmpty: boolean;
    count?: number;
    children: ReactNode;
}

// Local collapsible section. We don't reuse the shared `Collapsible` component
// because we need (a) parent-driven open/close state synced to the persisted
// atom, (b) a distinct visual treatment (the section header acts as a band
// with a count badge), and (c) section-specific class hooks so #1548 can
// later style the I/O bodies independently.
const DetailsSection = ({
    title,
    sectionKey,
    collapsed,
    onToggle,
    emptyHint,
    isEmpty,
    count,
    children,
}: DetailsSectionProps) => (
    <section className={classNames('mlir-node-details-section', `mlir-node-details-${sectionKey}`)}>
        <button
            type='button'
            className='mlir-node-details-section-header'
            aria-expanded={!collapsed}
            onClick={() => onToggle(sectionKey)}
        >
            <span className='mlir-node-details-section-caret'>{collapsed ? '▸' : '▾'}</span>
            <span className='mlir-node-details-section-title'>{title}</span>
            {typeof count === 'number' && <span className='mlir-node-details-section-count'>{count}</span>}
        </button>
        <Collapse
            isOpen={!collapsed}
            keepChildrenMounted
        >
            <div className='mlir-node-details-section-body'>
                {isEmpty ? <p className='mlir-node-details-empty'>{emptyHint}</p> : children}
            </div>
        </Collapse>
    </section>
);

const MlirNodeDetailsPanel = ({
    node,
    incomingEdges,
    outgoingEdges,
    onClose,
    onRecenter,
}: MlirNodeDetailsPanelProps) => {
    const [collapsed, setCollapsed] = useAtom(mlirNodeDetailsCollapsedAtom);

    const toggleSection = (key: SectionKey) => {
        setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    // Output ports come from two independent sources:
    //   1. `outputsMetadata` — per-port shape/dtype/etc declared on the node.
    //   2. Outgoing edges — synthesised consumer connections. Terminator ops
    //      (e.g. `stablehlo.return`) have empty outputsMetadata but still
    //      carry outgoing edges for region plumbing.
    // We union the two by port id, preserving the order from outputsMetadata
    // and appending any extra ports discovered only via outgoing edges.
    const outputPorts = useMemo<OutputPortView[]>(() => {
        const consumersByPort = new Map<string, OutgoingEdge[]>();
        for (const edge of outgoingEdges) {
            const list = consumersByPort.get(edge.sourceNodeOutputId);
            if (list) {
                list.push(edge);
            } else {
                consumersByPort.set(edge.sourceNodeOutputId, [edge]);
            }
        }
        const seen = new Set<string>();
        const ports: OutputPortView[] = node.outputsMetadata.map((port) => {
            seen.add(port.id);
            return {
                portId: port.id,
                metadata: port,
                consumers: consumersByPort.get(port.id) ?? [],
            };
        });
        for (const [portId, consumers] of consumersByPort) {
            if (!seen.has(portId)) {
                ports.push({ portId, metadata: null, consumers });
            }
        }
        return ports;
    }, [node.outputsMetadata, outgoingEdges]);

    return (
        <aside
            className='mlir-node-details-panel'
            aria-label='Selected node details'
        >
            <header className='mlir-node-details-header'>
                <div className='mlir-node-details-titles'>
                    <h2 className='mlir-node-details-label'>{node.label}</h2>
                    <p
                        className='mlir-node-details-id'
                        title={node.id}
                    >
                        {node.id}
                    </p>
                </div>
                <div className='mlir-node-details-actions'>
                    <Tooltip content='Recenter on this node'>
                        <Button
                            size={Size.SMALL}
                            variant={ButtonVariant.MINIMAL}
                            icon={IconNames.LOCATE}
                            aria-label='Recenter on this node'
                            onClick={onRecenter}
                        />
                    </Tooltip>
                    <Tooltip content='Close'>
                        <Button
                            size={Size.SMALL}
                            variant={ButtonVariant.MINIMAL}
                            icon={IconNames.CROSS}
                            aria-label='Close node details'
                            onClick={onClose}
                        />
                    </Tooltip>
                </div>
            </header>

            <DetailsSection
                title='Attributes'
                sectionKey='attrs'
                collapsed={collapsed.attrs}
                onToggle={toggleSection}
                emptyHint='No attributes.'
                isEmpty={node.attrs.length === 0}
                count={node.attrs.length}
            >
                <dl className='mlir-node-details-attrs'>
                    {node.attrs.map((attr) => (
                        <div
                            className='mlir-node-details-attr-row'
                            key={attr.key}
                        >
                            <dt className='mlir-node-details-attr-key'>{attr.key}</dt>
                            <dd className='mlir-node-details-attr-value'>
                                <MlirAttrValue value={attr.value} />
                            </dd>
                        </div>
                    ))}
                </dl>
            </DetailsSection>

            <DetailsSection
                title='Inputs'
                sectionKey='inputs'
                collapsed={collapsed.inputs}
                onToggle={toggleSection}
                emptyHint='No inputs.'
                isEmpty={incomingEdges.length === 0}
                count={incomingEdges.length}
            >
                {/* Placeholder rendering — #1548 replaces this with paginated
                    per-port metadata and #1549 adds click-to-locate. */}
                <ul className='mlir-node-details-io-list'>
                    {incomingEdges.map((edge, idx) => (
                        <li
                            key={`${edge.sourceNodeId}:${edge.sourceNodeOutputId}->${edge.targetNodeInputId}:${idx}`}
                            className='mlir-node-details-io-row'
                        >
                            <span className='mlir-node-details-io-id'>{edge.sourceNodeId}</span>
                            <span className='mlir-node-details-io-port'>
                                out {edge.sourceNodeOutputId} → in {edge.targetNodeInputId}
                            </span>
                            {edge.label && <span className='mlir-node-details-io-shape'>{edge.label}</span>}
                            {edge.sourcePortMetadata && edge.sourcePortMetadata.attrs.length > 0 && (
                                <dl className='mlir-node-details-attrs mlir-node-details-port-attrs'>
                                    {edge.sourcePortMetadata.attrs.map((attr) => (
                                        <div
                                            className='mlir-node-details-attr-row'
                                            key={attr.key}
                                        >
                                            <dt className='mlir-node-details-attr-key'>{attr.key}</dt>
                                            <dd className='mlir-node-details-attr-value'>
                                                <MlirAttrValue value={attr.value} />
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                        </li>
                    ))}
                </ul>
            </DetailsSection>

            <DetailsSection
                title='Outputs'
                sectionKey='outputs'
                collapsed={collapsed.outputs}
                onToggle={toggleSection}
                emptyHint='No outputs.'
                isEmpty={outputPorts.length === 0}
                count={outputPorts.length}
            >
                {/* Placeholder rendering — #1548 replaces this with paginated
                    per-port metadata and locate affordances. */}
                <ul className='mlir-node-details-io-list'>
                    {outputPorts.map((port) => (
                        <li
                            key={port.portId}
                            className='mlir-node-details-io-row mlir-node-details-output-row'
                        >
                            <span className='mlir-node-details-io-port'>port {port.portId}</span>
                            {port.metadata && port.metadata.attrs.length > 0 && (
                                <dl className='mlir-node-details-attrs mlir-node-details-port-attrs'>
                                    {port.metadata.attrs.map((attr) => (
                                        <div
                                            className='mlir-node-details-attr-row'
                                            key={attr.key}
                                        >
                                            <dt className='mlir-node-details-attr-key'>{attr.key}</dt>
                                            <dd className='mlir-node-details-attr-value'>
                                                <MlirAttrValue value={attr.value} />
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                            {port.consumers.length > 0 && (
                                <ul className='mlir-node-details-consumer-list'>
                                    {port.consumers.map((consumer, idx) => (
                                        <li
                                            key={`${consumer.targetNodeId}:${consumer.targetNodeInputId}:${idx}`}
                                            className='mlir-node-details-consumer-row'
                                        >
                                            <span className='mlir-node-details-io-id'>{consumer.targetNodeId}</span>
                                            <span className='mlir-node-details-io-port'>
                                                in {consumer.targetNodeInputId}
                                            </span>
                                            {consumer.label && (
                                                <span className='mlir-node-details-io-shape'>{consumer.label}</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {!port.metadata && port.consumers.length === 0 && (
                                <span className='mlir-node-details-empty-inline'>no metadata</span>
                            )}
                        </li>
                    ))}
                </ul>
            </DetailsSection>
        </aside>
    );
};

export default MlirNodeDetailsPanel;
