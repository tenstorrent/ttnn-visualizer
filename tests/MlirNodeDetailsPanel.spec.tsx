// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MlirNodeDetailsPanel from '../src/components/mlir/MlirNodeDetailsPanel';
import type {
    IncomingEdgeView,
    IndexedPortMetadata,
    OutgoingEdge,
    SourceNode,
} from '../src/components/mlir/mlirGraphTypes';
import { mlirNodeDetailsCollapsedAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import type { AtomProviderInitialValues } from './helpers/atomProvider';

afterEach(cleanup);

// Hydrate the collapsed-state atom with everything open so assertions
// don't have to click section headers first. The collapsed default is
// `{ attrs: false, inputs: true, outputs: true }` — the test wants all
// three bodies expanded.
const ALL_OPEN: AtomProviderInitialValues = [
    [mlirNodeDetailsCollapsedAtom, { attrs: false, inputs: false, outputs: false }],
];

const BASE_NODE: SourceNode = {
    id: 'loc("-":4:12)__1',
    label: 'stablehlo.dot_general',
    namespace: 'func.func_main/stablehlo.dot_general_0',
    attrs: [
        { key: 'precision_config', value: '["DEFAULT","DEFAULT"]' },
        { key: 'is_stable', value: 'true' },
    ],
    incomingEdges: [],
    outputsMetadata: [],
    config: null,
};

const SHAPE_DTYPE_PORT: IndexedPortMetadata = {
    id: '0',
    attrs: [
        { key: 'shape', value: '[4, 8]' },
        { key: 'dtype', value: 'f32' },
    ],
};

interface RenderPanelOverrides {
    node?: SourceNode;
    incomingEdges?: IncomingEdgeView[];
    outgoingEdges?: OutgoingEdge[];
    outputsMetadata?: IndexedPortMetadata[];
    onClose?: () => void;
    onRecenter?: () => void;
    onNavigateToNode?: (nodeId: string) => void;
}

function renderPanel(overrides: RenderPanelOverrides = {}) {
    const node = overrides.node ?? BASE_NODE;
    return render(
        <TestProviders initialAtomValues={ALL_OPEN}>
            <MlirNodeDetailsPanel
                node={node}
                incomingEdges={overrides.incomingEdges ?? []}
                outgoingEdges={overrides.outgoingEdges ?? []}
                outputsMetadata={overrides.outputsMetadata ?? node.outputsMetadata}
                onClose={overrides.onClose ?? (() => {})}
                onRecenter={overrides.onRecenter ?? (() => {})}
                onNavigateToNode={overrides.onNavigateToNode ?? (() => {})}
            />
        </TestProviders>,
    );
}

describe('MlirNodeDetailsPanel header', () => {
    it('renders the op label as the heading and the raw node id below', () => {
        renderPanel();
        expect(screen.getByRole('heading', { name: 'stablehlo.dot_general' })).toBeInTheDocument();
        expect(screen.getByText('loc("-":4:12)__1')).toBeInTheDocument();
    });

    it('calls onClose when the close button is clicked', () => {
        const onClose = vi.fn();
        renderPanel({ onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Close node details' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onRecenter when the recenter button is clicked', () => {
        const onRecenter = vi.fn();
        renderPanel({ onRecenter });
        fireEvent.click(screen.getByRole('button', { name: 'Recenter' }));
        expect(onRecenter).toHaveBeenCalledTimes(1);
    });
});

describe('MlirNodeDetailsPanel Attributes section', () => {
    it('renders each attribute as a key/value row, with a count badge in the header', () => {
        const { container } = renderPanel();
        const attrsSection = container.querySelector('.mlir-node-details-attrs');
        expect(attrsSection).not.toBeNull();
        expect(within(attrsSection as HTMLElement).getByText('precision_config')).toBeInTheDocument();
        expect(within(attrsSection as HTMLElement).getByText('is_stable')).toBeInTheDocument();
        // Section count badge equals the number of attrs.
        expect(screen.getByText('Attributes').parentElement?.textContent).toContain(String(BASE_NODE.attrs.length));
    });

    it('shows the empty hint when there are no attrs', () => {
        renderPanel({ node: { ...BASE_NODE, attrs: [] } });
        expect(screen.getByText('No attributes.')).toBeInTheDocument();
    });
});

describe('MlirNodeDetailsPanel Inputs section', () => {
    it('shows the empty hint when there are no incoming edges', () => {
        renderPanel();
        expect(screen.getByText('No inputs.')).toBeInTheDocument();
    });

    it('renders the producer op label as the primary line and the raw id below', () => {
        const incoming: IncomingEdgeView[] = [
            {
                sourceNodeId: 'loc("-":3:8)__0',
                sourceNodeLabel: 'stablehlo.broadcast_in_dim',
                sourceNodeOutputId: '0',
                targetNodeInputId: '0',
                label: '[4, 8] f32',
                sourcePortMetadata: SHAPE_DTYPE_PORT,
            },
        ];
        const { container } = renderPanel({ incomingEdges: incoming });
        const inputsBody = container.querySelector('.mlir-node-details-inputs .mlir-node-details-section-body');
        expect(inputsBody).not.toBeNull();
        expect(within(inputsBody as HTMLElement).getByText('stablehlo.broadcast_in_dim')).toBeInTheDocument();
        expect(within(inputsBody as HTMLElement).getByText('loc("-":3:8)__0')).toBeInTheDocument();
    });

    it('collapses to a single id line when the producer label duplicates the id (e.g. arg nodes)', () => {
        const incoming: IncomingEdgeView[] = [
            {
                sourceNodeId: '%arg42',
                sourceNodeLabel: '%arg42',
                sourceNodeOutputId: '0',
                targetNodeInputId: '0',
                label: '[8] f32',
                sourcePortMetadata: null,
            },
        ];
        const { container } = renderPanel({ incomingEdges: incoming });
        const inputsBody = container.querySelector('.mlir-node-details-inputs .mlir-node-details-section-body');
        // Only the id renders — there's no separate label/loc pair.
        const matches = within(inputsBody as HTMLElement).getAllByText('%arg42');
        expect(matches).toHaveLength(1);
        expect(matches[0].className).toContain('mlir-node-details-io-id');
    });

    it('renders the compact port pill from sourcePortMetadata and suppresses the redundant edge.label', () => {
        // edge.label and the port-derived compact pill carry the same `[shape] dtype`
        // string. Rendering both made the row look like a sizing bug — the panel
        // now suppresses edge.label when port metadata is present.
        const incoming: IncomingEdgeView[] = [
            {
                sourceNodeId: 'loc("-":3:8)__0',
                sourceNodeLabel: 'stablehlo.broadcast_in_dim',
                sourceNodeOutputId: '0',
                targetNodeInputId: '0',
                label: '[4, 8] f32',
                sourcePortMetadata: SHAPE_DTYPE_PORT,
            },
        ];
        const { container } = renderPanel({ incomingEdges: incoming });
        const inputsBody = container.querySelector('.mlir-node-details-inputs .mlir-node-details-section-body');
        expect(inputsBody?.querySelector('.mlir-port-attrs-compact')?.textContent).toBe('[4, 8] f32');
        // edge.label uses .mlir-node-details-io-shape — should not be in the inputs row.
        expect(inputsBody?.querySelector('.mlir-node-details-io-shape')).toBeNull();
    });

    it('falls back to the edge.label shape line when sourcePortMetadata is null', () => {
        const incoming: IncomingEdgeView[] = [
            {
                sourceNodeId: '%arg42',
                sourceNodeLabel: '%arg42',
                sourceNodeOutputId: '0',
                targetNodeInputId: '0',
                label: '[4] f32',
                sourcePortMetadata: null,
            },
        ];
        const { container } = renderPanel({ incomingEdges: incoming });
        const inputsBody = container.querySelector('.mlir-node-details-inputs .mlir-node-details-section-body');
        expect(inputsBody?.querySelector('.mlir-port-attrs-compact')).toBeNull();
        expect(inputsBody?.querySelector('.mlir-node-details-io-shape')?.textContent).toBe('[4] f32');
    });

    it('renders the producer port → consumer port mapping for each incoming edge', () => {
        const incoming: IncomingEdgeView[] = [
            {
                sourceNodeId: 'loc("-":3:8)__0',
                sourceNodeLabel: 'stablehlo.broadcast_in_dim',
                sourceNodeOutputId: '2',
                targetNodeInputId: '1',
                sourcePortMetadata: null,
            },
        ];
        renderPanel({ incomingEdges: incoming });
        expect(screen.getByText('out 2 → in 1')).toBeInTheDocument();
    });

    it('calls onNavigateToNode with the producer id when the row locate button is clicked', () => {
        const incoming: IncomingEdgeView[] = [
            {
                sourceNodeId: 'loc("-":3:8)__0',
                sourceNodeLabel: 'stablehlo.broadcast_in_dim',
                sourceNodeOutputId: '0',
                targetNodeInputId: '0',
                sourcePortMetadata: null,
            },
        ];
        const onNavigateToNode = vi.fn();
        const { container } = renderPanel({ incomingEdges: incoming, onNavigateToNode });
        const inputsBody = container.querySelector(
            '.mlir-node-details-inputs .mlir-node-details-section-body',
        ) as HTMLElement;
        fireEvent.click(within(inputsBody).getByRole('button', { name: 'Locate stablehlo.broadcast_in_dim' }));
        expect(onNavigateToNode).toHaveBeenCalledTimes(1);
        expect(onNavigateToNode).toHaveBeenCalledWith('loc("-":3:8)__0');
    });
});

describe('MlirNodeDetailsPanel Outputs section', () => {
    it('shows the empty hint when there are no outputs and no outgoing edges', () => {
        renderPanel();
        expect(screen.getByText('No outputs.')).toBeInTheDocument();
    });

    it('renders the compact port pill for each output port that carries shape + dtype', () => {
        const { container } = renderPanel({ outputsMetadata: [SHAPE_DTYPE_PORT] });
        const outputsBody = container.querySelector('.mlir-node-details-outputs .mlir-node-details-section-body');
        expect(outputsBody?.querySelector('.mlir-port-attrs-compact')?.textContent).toBe('[4, 8] f32');
    });

    it('renders the consumer list under the originating port, with the consumer label and shape', () => {
        const outgoing: OutgoingEdge[] = [
            {
                targetNodeId: 'loc("-":7:4)__2',
                targetNodeLabel: 'stablehlo.add',
                sourceNodeOutputId: '0',
                targetNodeInputId: '0',
                label: '[4, 8] f32',
            },
            {
                targetNodeId: 'loc("-":9:4)__3',
                targetNodeLabel: 'stablehlo.reshape',
                sourceNodeOutputId: '0',
                targetNodeInputId: '1',
                label: '[4, 8] f32',
            },
        ];
        const { container } = renderPanel({
            outputsMetadata: [SHAPE_DTYPE_PORT],
            outgoingEdges: outgoing,
        });
        const consumerList = container.querySelector('.mlir-node-details-consumer-list');
        expect(consumerList).not.toBeNull();
        expect(within(consumerList as HTMLElement).getByText('stablehlo.add')).toBeInTheDocument();
        expect(within(consumerList as HTMLElement).getByText('stablehlo.reshape')).toBeInTheDocument();
        expect(within(consumerList as HTMLElement).getByText('in 0')).toBeInTheDocument();
        expect(within(consumerList as HTMLElement).getByText('in 1')).toBeInTheDocument();
        // Consumer rows DO render edge.label (no producing port metadata at that nesting level).
        expect(consumerList?.querySelectorAll('.mlir-node-details-io-shape')).toHaveLength(2);
    });

    it('surfaces consumer-only ports synthesised from outgoing edges when outputsMetadata is empty', () => {
        // Terminator ops (e.g. `stablehlo.return`) carry no outputsMetadata
        // of their own but still have outgoing edges. The panel should still
        // show the port + consumer list rather than the empty hint.
        const outgoing: OutgoingEdge[] = [
            {
                targetNodeId: 'stablehlo.reshape_0',
                targetNodeLabel: 'stablehlo.reshape',
                sourceNodeOutputId: '0',
                targetNodeInputId: '0',
                label: '[7, 3072] bf16',
            },
        ];
        const { container } = renderPanel({ outputsMetadata: [], outgoingEdges: outgoing });
        expect(screen.queryByText('No outputs.')).toBeNull();
        expect(screen.getByText('port 0')).toBeInTheDocument();
        const consumerList = container.querySelector('.mlir-node-details-consumer-list');
        expect(within(consumerList as HTMLElement).getByText('stablehlo.reshape')).toBeInTheDocument();
    });

    it('calls onNavigateToNode with the consumer id when the row locate button is clicked', () => {
        const outgoing: OutgoingEdge[] = [
            {
                targetNodeId: 'loc("-":7:4)__2',
                targetNodeLabel: 'stablehlo.add',
                sourceNodeOutputId: '0',
                targetNodeInputId: '0',
                label: '[4, 8] f32',
            },
        ];
        const onNavigateToNode = vi.fn();
        const { container } = renderPanel({
            outputsMetadata: [SHAPE_DTYPE_PORT],
            outgoingEdges: outgoing,
            onNavigateToNode,
        });
        const consumerList = container.querySelector('.mlir-node-details-consumer-list') as HTMLElement;
        fireEvent.click(within(consumerList).getByRole('button', { name: 'Locate stablehlo.add' }));
        expect(onNavigateToNode).toHaveBeenCalledTimes(1);
        expect(onNavigateToNode).toHaveBeenCalledWith('loc("-":7:4)__2');
    });

    it('renders an explicit port that carries empty attrs as a bare `port X` row with no metadata block', () => {
        // Some adapter outputs declare an output port but ship an empty
        // `attrs` array (the port exists, it just has no descriptors).
        // The panel should still surface the port id; it just has nothing
        // else to render for it — no compact pill, no extras list, no
        // consumer list, no "no metadata" hint.
        const emptyPort: IndexedPortMetadata = { id: '1', attrs: [] };
        const { container } = renderPanel({ outputsMetadata: [emptyPort] });
        const outputsBody = container.querySelector('.mlir-node-details-outputs .mlir-node-details-section-body');
        expect(outputsBody).not.toBeNull();
        expect(within(outputsBody as HTMLElement).getByText('port 1')).toBeInTheDocument();
        expect(outputsBody?.querySelector('.mlir-port-attrs-compact')).toBeNull();
        expect(outputsBody?.querySelector('.mlir-node-details-consumer-list')).toBeNull();
    });
});
