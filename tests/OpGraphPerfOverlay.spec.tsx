// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ReactNode } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { PerfOverlaySource } from '../src/functions/perfOverlay';
import type { OperationDescription } from '../src/model/APIData';
import type {
    OpGraphBuildOptions,
    OpGraphBuiltGraph,
    OpGraphFlowNode,
} from '../src/components/operation-graph/opGraphTypes';

// Shared with the `vi.mock` factories below, which are hoisted above the module
// body. `runBuild` has to keep one identity across renders: the view rebuilds
// whenever that callback changes, so a fresh closure per render would make
// every render look like a layout request and hide the invariant under test.
const harness = vi.hoisted(() => ({
    capturedNodes: [] as unknown[],
    capturedPanelProps: null as Record<string, unknown> | null,
    runBuildCalls: [] as unknown[],
    emitBuilt: null as ((graph: unknown) => void) | null,
    runBuild(options: unknown) {
        harness.runBuildCalls.push(options);
    },
}));

// React Flow needs a real layout engine and a measured container, neither of
// which jsdom has, so the canvas is stubbed and the nodes it would have drawn
// are recorded instead. Node/edge state stays real, because what the view
// derives from a built graph is exactly what these tests assert on.
vi.mock('@xyflow/react', async () => {
    const { useState } = await import('react');
    const passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
    return {
        ReactFlow: ({ nodes, children }: { nodes: unknown[]; children?: ReactNode }) => {
            harness.capturedNodes = nodes;
            return children ?? null;
        },
        ReactFlowProvider: passthrough,
        Background: () => null,
        Controls: () => null,
        MiniMap: () => null,
        Handle: () => null,
        BaseEdge: () => null,
        useStore: () => true,
        Position: { Top: 'top', Bottom: 'bottom' },
        MarkerType: { ArrowClosed: 'arrowclosed' },
        useReactFlow: () => ({ setCenter: vi.fn(), getNode: vi.fn() }),
        useNodesState: (initial: unknown[]) => {
            const [nodes, setNodes] = useState(initial);
            return [nodes, setNodes, vi.fn()];
        },
        useEdgesState: (initial: unknown[]) => {
            const [edges, setEdges] = useState(initial);
            return [edges, setEdges, vi.fn()];
        },
    };
});

// The worker can't run under jsdom, and holding `onBuilt` lets a test drive the
// graph in by hand and count which interactions ask for a new layout.
vi.mock('../src/components/operation-graph/useOpGraphLayoutWorker', () => ({
    useOpGraphLayoutWorker: (_operations: unknown, onBuilt: (graph: unknown) => void) => {
        harness.emitBuilt = onBuilt;
        return { runBuild: harness.runBuild, isBuilding: false };
    },
}));

// The panel pulls in routing and source-file probing; only the perf props it
// receives are relevant here.
vi.mock('../src/components/operation-graph/OpGraphInfoPanel', () => ({
    default: (props: Record<string, unknown>) => {
        harness.capturedPanelProps = props;
        return null;
    },
}));

// eslint-disable-next-line import/first
import OperationGraphReactFlow from '../src/components/operation-graph/OperationGraphReactFlow';

// Only the fields the view reads. The graph arrives pre-built through `onBuilt`,
// so the rest of `OperationDescription` never gets touched.
const operation = (id: number, name: string): OperationDescription =>
    ({ id, name, operationFileIdentifier: `${name}.py:1`, inputs: [], outputs: [] }) as unknown as OperationDescription;

const OPERATIONS = [operation(1, 'matmul'), operation(2, 'add')];

const node = (operationId: number): OpGraphFlowNode =>
    ({
        id: String(operationId),
        type: 'opNode',
        position: { x: 0, y: 0 },
        data: { operationId, label: `${operationId} op`, fileIdentifier: '', filterString: 'op' },
    }) as OpGraphFlowNode;

// Node 1 feeds node 2, so selecting 1 makes 2 an output neighbour.
const BUILT = {
    nodes: [node(1), node(2)],
    edges: [{ id: '1-2-0', source: '1', target: '2', type: 'opEdge', data: { parallelIndex: 0 } }],
} as OpGraphBuiltGraph;

// `device_time` is µs on the wire. Two ops two orders of magnitude apart, so
// scoring puts them at opposite ends of the ramp instead of collapsing to t=0.
const LINKED_PERF_ROWS: PerfOverlaySource[] = [
    { id: 1, device_time: 10 },
    { id: 2, device_time: 1000 },
];

const renderGraph = (perfRows?: PerfOverlaySource[], isPerfReportLoaded?: boolean) => {
    render(
        <OperationGraphReactFlow
            operationList={OPERATIONS}
            perfRows={perfRows}
            isPerfReportLoaded={isPerfReportLoaded}
        />,
    );
    act(() => harness.emitBuilt?.(BUILT));
};

const perfSwitch = () => screen.getByRole('checkbox', { name: 'Perf overlay' });
const nodeById = (id: string) =>
    harness.capturedNodes.find((candidate) => (candidate as OpGraphFlowNode).id === id) as OpGraphFlowNode | undefined;

afterEach(cleanup);
beforeEach(() => {
    harness.capturedNodes = [];
    harness.capturedPanelProps = null;
    harness.runBuildCalls = [];
    harness.emitBuilt = null;
});

describe('operation graph perf overlay', () => {
    it('offers the overlay only when a loaded perf report links to this graph', () => {
        renderGraph(undefined, false);
        expect(perfSwitch()).toBeDisabled();
        cleanup();

        // A report is loaded, but it describes a different run: no op id lines up.
        renderGraph([{ id: 999, device_time: 10 }], true);
        expect(perfSwitch()).toBeDisabled();
        cleanup();

        renderGraph(LINKED_PERF_ROWS, true);
        expect(perfSwitch()).toBeEnabled();
    });

    it('restyles in place instead of asking for a new layout', () => {
        renderGraph(LINKED_PERF_ROWS, true);
        const buildsBefore = harness.runBuildCalls.length;

        fireEvent.click(perfSwitch());

        // The point of the migration: overlay colour is a style mapping, so
        // toggling it must not re-run Dagre and throw away the user's drags.
        expect(harness.runBuildCalls).toHaveLength(buildsBefore);
        expect(nodeById('1')?.style?.backgroundColor).toBeTruthy();
    });

    it('does ask for a new layout when compact spacing changes', () => {
        renderGraph(LINKED_PERF_ROWS, true);
        const buildsBefore = harness.runBuildCalls.length;

        fireEvent.click(screen.getByRole('checkbox', { name: 'Compact view' }));

        expect(harness.runBuildCalls).toHaveLength(buildsBefore + 1);
        expect((harness.runBuildCalls.at(-1) as OpGraphBuildOptions).isCompact).toBe(true);
    });

    it('leaves a relation colour in place rather than overpainting it with the ramp', () => {
        renderGraph(LINKED_PERF_ROWS, true);

        fireEvent.click(perfSwitch());

        // Node 1 is selected and node 2 is its output. The selection takes its
        // ramp colour; the neighbour keeps the tint that answers "what does this
        // touch", which is the question the user asked more recently.
        expect(nodeById('1')?.style?.backgroundColor).toBeTruthy();
        expect(nodeById('2')?.className).toContain('op-graph-node-output');
        expect(nodeById('2')?.style?.backgroundColor).toBeUndefined();
    });

    it('flips the label light only on the dark end of the ramp', () => {
        renderGraph(LINKED_PERF_ROWS, true);

        fireEvent.click(perfSwitch());

        // Node 1 is the faster of the two, so it sits at t=0 — the coldest bin,
        // dark enough to sink the near-black default label.
        expect(nodeById('1')?.className).toContain('op-graph-node-perf-dark');
    });

    it("shows the legend and the selected op's duration only while the overlay is on", () => {
        renderGraph(LINKED_PERF_ROWS, true);

        expect(screen.queryByLabelText('Perf overlay legend')).not.toBeInTheDocument();
        expect(harness.capturedPanelProps?.isPerfOverlayActive).toBe(false);

        fireEvent.click(perfSwitch());

        expect(screen.getByLabelText('Perf overlay legend')).toBeInTheDocument();
        expect(harness.capturedPanelProps?.isPerfOverlayActive).toBe(true);
        expect(harness.capturedPanelProps?.perfDeviceTimeNs).toBe(10_000);
        expect(harness.capturedPanelProps?.perfColor).toBeTruthy();
    });
});
