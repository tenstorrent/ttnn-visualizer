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
import MlirPortAttrs from './MlirPortAttrs';
import { mlirNodeDetailsCollapsedAtom } from '../../store/app';

interface MlirNodeDetailsPanelProps {
    node: SourceNode;
    incomingEdges: IncomingEdgeView[];
    outgoingEdges: OutgoingEdge[];
    /**
     * Output-port metadata to render in the Outputs section. Usually
     * `node.outputsMetadata`, but for nodes that share a logical output with
     * a region partner (e.g. a `stablehlo.return` terminator paired with its
     * outer `stablehlo.reduce`), the view supplies the partner's metadata so
     * both selections render consistent data.
     */
    outputsMetadata: IndexedPortMetadata[];
    onClose: () => void;
    onRecenter: () => void;
    /**
     * Invoked when the user clicks the "locate" affordance next to a producer
     * (Inputs) or consumer (Outputs) reference. The view auto-expands any
     * namespaces the target sits inside and recenters the canvas on it; the
     * current selection — and therefore the panel itself — is intentionally
     * left untouched so the user can keep exploring the originating op's
     * I/O while peeking at where its neighbours live.
     */
    onNavigateToNode: (nodeId: string) => void;
}

interface OutputPortView {
    portId: string;
    metadata: IndexedPortMetadata | null;
    consumers: OutgoingEdge[];
}

type SectionKey = 'attrs' | 'inputs' | 'outputs';

interface NodeRefProps {
    label: string | null;
    id: string;
}

/** Two-line node reference: op label on top, raw id below.
 *
 * Producer/consumer rows in Inputs/Outputs need to surface the op name
 * (e.g. `stablehlo.add`) because the raw id is usually a location string
 * (`loc("-":33:13)__1`) that doesn't read as the op. We show both so the
 * user can match the row to a node on the canvas by either signal.
 *
 * When the label is missing or duplicates the id (rare — e.g. synthesised
 * arg nodes), we collapse to just the id so we don't render the same
 * string twice. */
const NodeRef = ({ label, id }: NodeRefProps) => {
    if (label && label !== id) {
        return (
            <>
                <span className='mlir-node-details-io-label'>{label}</span>
                <span
                    className='mlir-node-details-io-loc'
                    title={id}
                >
                    {id}
                </span>
            </>
        );
    }
    return <span className='mlir-node-details-io-id'>{id}</span>;
};

interface LinkedNodeRefProps {
    label: string | null;
    id: string;
    onNavigate: (nodeId: string) => void;
}

// Pairs a NodeRef with a small "locate" icon button. The button is the click
// target — keeping it discrete (vs. making the whole label clickable) keeps
// drag-to-select on the label text working and matches the recenter icon
// already in the panel header so the affordance reads as the same gesture
// scoped to a single linked node.
const LinkedNodeRef = ({ label, id, onNavigate }: LinkedNodeRefProps) => (
    <div className='mlir-node-details-io-ref'>
        <div className='mlir-node-details-io-names'>
            <NodeRef
                label={label}
                id={id}
            />
        </div>
        <Tooltip
            content='Locate'
            compact
        >
            <Button
                className='mlir-node-details-io-locate'
                size={Size.SMALL}
                variant={ButtonVariant.MINIMAL}
                icon={IconNames.LOCATE}
                aria-label={`Locate ${label ?? id}`}
                onClick={() => onNavigate(id)}
            />
        </Tooltip>
    </div>
);

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
    outputsMetadata,
    onClose,
    onRecenter,
    onNavigateToNode: handleNavigateToNode,
}: MlirNodeDetailsPanelProps) => {
    const [collapsed, setCollapsed] = useAtom(mlirNodeDetailsCollapsedAtom);

    const toggleSection = (key: SectionKey) => {
        setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    // Output ports come from two independent sources:
    //   1. `outputsMetadata` — per-port shape/dtype/etc. For region terminator
    //      ops the view sources this from the outer-op partner so both ends
    //      of the pair show the same per-port info.
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
        const ports: OutputPortView[] = outputsMetadata.map((port) => {
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
    }, [outputsMetadata, outgoingEdges]);

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
                    <Tooltip content='Recenter'>
                        <Button
                            size={Size.SMALL}
                            variant={ButtonVariant.MINIMAL}
                            icon={IconNames.LOCATE}
                            aria-label='Recenter'
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
                            <LinkedNodeRef
                                label={edge.sourceNodeLabel}
                                id={edge.sourceNodeId}
                                onNavigate={handleNavigateToNode}
                            />
                            <span className='mlir-node-details-io-port'>
                                out {edge.sourceNodeOutputId} → in {edge.targetNodeInputId}
                            </span>
                            {/* When sourcePortMetadata is present, MlirPortAttrs renders
                                a compact `[shape] dtype` pill derived from the same
                                tensor attrs that produced `edge.label`. Showing both is
                                redundant and the slightly different font sizes look like
                                a visual bug — fall back to edge.label only when no port
                                metadata is available (e.g. input args, raw producers). */}
                            {edge.sourcePortMetadata ? (
                                <MlirPortAttrs attrs={edge.sourcePortMetadata.attrs} />
                            ) : (
                                edge.label && <span className='mlir-node-details-io-shape'>{edge.label}</span>
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
                            {port.metadata && <MlirPortAttrs attrs={port.metadata.attrs} />}
                            {port.consumers.length > 0 && (
                                <ul className='mlir-node-details-consumer-list'>
                                    {port.consumers.map((consumer, idx) => (
                                        <li
                                            key={`${consumer.targetNodeId}:${consumer.targetNodeInputId}:${idx}`}
                                            className='mlir-node-details-consumer-row'
                                        >
                                            <LinkedNodeRef
                                                label={consumer.targetNodeLabel}
                                                id={consumer.targetNodeId}
                                                onNavigate={handleNavigateToNode}
                                            />
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
