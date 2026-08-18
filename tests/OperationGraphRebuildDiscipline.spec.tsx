// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { NodeChange } from '@xyflow/react';

import type { OperationDescription } from '../src/model/APIData';
import type {
    OpGraphBuiltGraph,
    OpGraphFlowEdge,
    OpGraphFlowNode,
} from '../src/components/operation-graph/opGraphTypes';

// A layout is the most expensive thing this view can do, and every cheap
// interaction — typing, selecting, stepping matches — is one dependency array away
// from triggering one. Nothing else counts `runBuild`, so a plausible-looking
// tidy-up of that effect's deps would relayout per keystroke and still go green.
const runBuild = vi.fn();

// Populated on render by the stubs below. Renders accumulate so a test can compare
// what React Flow was handed before and after an interaction.
const flowRenders: { nodes: OpGraphFlowNode[]; edges: OpGraphFlowEdge[] }[] = [];
const harness: {
    onBuilt: ((graph: OpGraphBuiltGraph) => void) | null;
    setNodes: ((updater: (previous: OpGraphFlowNode[]) => OpGraphFlowNode[]) => void) | null;
    onNodeClick: ((event: unknown, node: OpGraphFlowNode) => void) | null;
    onNodesChange: ((changes: NodeChange<OpGraphFlowNode>[]) => void) | null;
} = { onBuilt: null, setNodes: null, onNodeClick: null, onNodesChange: null };

// What `useNodesState` hands the view as its change applier. Stable, because the
// view's own handler lists it as a dependency.
const applyNodeChanges = vi.fn();

vi.mock('@xyflow/react', async () => {
    const { useState } = await import('react');
    const Passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
    // Stable across renders: the real `useReactFlow` returns a stable API object,
    // and an unstable one here would invalidate the callbacks whose stability the
    // rebuild effect depends on, quietly weakening every assertion below.
    const flowApi = {
        setCenter: () => Promise.resolve(),
        getNode: (id: string) => ({ id, position: { x: 0, y: 0 }, width: 100, height: 40 }),
    };
    // Stable for the same reason as `flowApi`: the perf overlay's zoom effect
    // lists the store among its dependencies, so a fresh object per render would
    // tear down and resubscribe on every pass.
    const flowStoreApi = {
        getState: () => ({ transform: [0, 0, 1] as [number, number, number] }),
        subscribe: () => () => {},
    };
    return {
        ReactFlow: ({
            nodes,
            edges,
            onNodeClick,
            onNodesChange,
            children,
        }: {
            nodes: OpGraphFlowNode[];
            edges: OpGraphFlowEdge[];
            onNodeClick: (event: unknown, node: OpGraphFlowNode) => void;
            onNodesChange: (changes: NodeChange<OpGraphFlowNode>[]) => void;
            children?: ReactNode;
        }) => {
            flowRenders.push({ nodes, edges });
            harness.onNodeClick = onNodeClick;
            harness.onNodesChange = onNodesChange;
            return children ?? null;
        },
        ReactFlowProvider: Passthrough,
        Background: () => null,
        Controls: () => null,
        Handle: () => null,
        MiniMap: () => null,
        Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
        MarkerType: { ArrowClosed: 'arrowclosed' },
        ConnectionLineType: { SmoothStep: 'smoothstep' },
        useReactFlow: () => flowApi,
        useStoreApi: () => flowStoreApi,
        useNodesState: (initial: OpGraphFlowNode[]) => {
            const [value, setValue] = useState(initial);
            harness.setNodes = setValue;
            return [value, setValue, applyNodeChanges];
        },
        useEdgesState: (initial: OpGraphFlowEdge[]) => {
            const [value, setValue] = useState(initial);
            return [value, setValue, () => {}];
        },
        useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
            selector({ transform: [0, 0, 1] }),
    };
});

vi.mock('../src/components/operation-graph/useOpGraphLayoutWorker', () => ({
    useOpGraphLayoutWorker: (_operations: unknown, onBuilt: (graph: OpGraphBuiltGraph) => void) => {
        harness.onBuilt = onBuilt;
        return { runBuild, isBuilding: false };
    },
}));

// Imported after the `vi.mock` factories so the stubs are registered first. The
// builder is the real one: the identity assertions below only mean something
// against the node shapes production actually produces.
/* eslint-disable import/first */
import { buildOpGraph } from '../src/components/operation-graph/opGraphBuilder';
import OperationGraphReactFlow from '../src/components/operation-graph/OperationGraphReactFlow';
/* eslint-enable import/first */

const FILTER_DEBOUNCE_MS = 120;

const operation = (id: number, name: string, consumers: number[]): OperationDescription =>
    ({
        id,
        name,
        operationFileIdentifier: `model.py:${id}`,
        outputs: [{ shape: 'Shape([1, 32])', consumers }],
        inputs: [],
        arguments: [],
    }) as unknown as OperationDescription;

// A chain, so every op is connected and survives the builder's isolated-op drop.
// Two `matmul` names give a filter something to match that is a strict subset.
const OPERATION_LIST: OperationDescription[] = [
    operation(1, 'matmul_a', [2]),
    operation(2, 'add_b', [3]),
    operation(3, 'matmul_c', [4]),
    operation(4, 'relu_d', [5]),
    operation(5, 'softmax_e', []),
];

const sourceFor = (operations: OperationDescription[]) =>
    operations.map((op) => ({
        id: op.id,
        name: op.name,
        fileIdentifier: op.operationFileIdentifier,
        outputs: op.outputs.map((tensor) => ({ edgeLabel: '[1, 32]', consumers: tensor.consumers })),
    }));

const renderGraph = (operations = OPERATION_LIST) => {
    const view = render(
        <MemoryRouter>
            <OperationGraphReactFlow operationList={operations} />
        </MemoryRouter>,
    );
    // The worker is stubbed, so the view only receives a graph when a test says
    // so; this is the reply the mount's own `runBuild` would have produced.
    act(() => {
        harness.onBuilt?.(buildOpGraph(sourceFor(operations), { hideDeallocate: true }));
    });
    return view;
};

const lastFlowRender = () => flowRenders[flowRenders.length - 1];

const nodeById = (nodes: OpGraphFlowNode[], id: string) => {
    const found = nodes.find((node) => node.id === id);
    expect(found, `node ${id} missing`).toBeDefined();
    return found as OpGraphFlowNode;
};

const typeFilter = (query: string) => {
    fireEvent.change(screen.getByPlaceholderText('Filter ops (substring)'), { target: { value: query } });
    act(() => {
        vi.advanceTimersByTime(FILTER_DEBOUNCE_MS);
    });
};

const emitNodeChanges = (changes: NodeChange<OpGraphFlowNode>[]) => {
    act(() => {
        harness.onNodesChange?.(changes);
    });
};

beforeEach(() => {
    vi.useFakeTimers();
    runBuild.mockClear();
    applyNodeChanges.mockClear();
    flowRenders.length = 0;
    harness.onBuilt = null;
    harness.setNodes = null;
    harness.onNodeClick = null;
    harness.onNodesChange = null;
    sessionStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('OperationGraphReactFlow rebuild triggers', () => {
    it('lays out once for a mount', () => {
        renderGraph();

        expect(runBuild).toHaveBeenCalledTimes(1);
    });

    it('does not relayout for a filter query', () => {
        renderGraph();
        runBuild.mockClear();

        typeFilter('matmul');

        // Filtering dims nodes that are already laid out. Routing it through the
        // build would run Dagre per debounce window on the full graph.
        expect(runBuild).not.toHaveBeenCalled();
    });

    it('does not relayout for a filter mode change', () => {
        renderGraph();
        typeFilter('matmul');
        runBuild.mockClear();

        fireEvent.click(screen.getByLabelText('Switch to regex mode'));

        expect(runBuild).not.toHaveBeenCalled();
    });

    it('does not relayout for a selection', () => {
        renderGraph();
        runBuild.mockClear();

        act(() => {
            harness.onNodeClick?.(null, nodeById(lastFlowRender().nodes, '3'));
        });

        expect(runBuild).not.toHaveBeenCalled();
    });

    it('does not relayout for stepping through matches', () => {
        renderGraph();
        typeFilter('matmul');
        runBuild.mockClear();

        fireEvent.click(screen.getByLabelText('Next match'));
        fireEvent.click(screen.getByLabelText('Next match'));

        expect(runBuild).not.toHaveBeenCalled();
    });

    it('relayouts when hide-deallocate is toggled, because the node set changes', () => {
        renderGraph();
        runBuild.mockClear();

        fireEvent.click(screen.getByLabelText('Hide deallocate ops'));

        expect(runBuild).toHaveBeenCalledTimes(1);
        expect(runBuild).toHaveBeenLastCalledWith({ hideDeallocate: false });
    });

    it('relayouts when the report changes', () => {
        const { rerender } = renderGraph();
        runBuild.mockClear();

        rerender(
            <MemoryRouter>
                <OperationGraphReactFlow operationList={[operation(9, 'conv_x', [10]), operation(10, 'add_y', [])]} />
            </MemoryRouter>,
        );

        expect(runBuild).toHaveBeenCalledTimes(1);
    });
});

describe('OperationGraphReactFlow keyboard selection', () => {
    // Enter or Space on a focused node is handled inside React Flow: it emits a
    // select change and never calls `onNodeClick`. Before this was read, the ring
    // moved and nothing else did — no panel, no neighbour highlight, no cursor.
    it('adopts a selection reported without a click', () => {
        renderGraph();
        emitNodeChanges([{ type: 'select', id: '3', selected: true }]);

        const { nodes } = lastFlowRender();
        expect(nodeById(nodes, '3').className).toContain('op-graph-node-selected');
        // The neighbour highlight is derived from app state, so its arrival is what
        // proves the selection reached the app and not just React Flow's store.
        expect(nodeById(nodes, '2').className).toContain('op-graph-node-input');
        expect(nodeById(nodes, '4').className).toContain('op-graph-node-output');
    });

    it('mirrors the selection back so React Flow agrees about what is selected', () => {
        renderGraph();

        act(() => {
            harness.onNodeClick?.(null, nodeById(lastFlowRender().nodes, '4'));
        });

        const { nodes } = lastFlowRender();
        expect(nodeById(nodes, '4').selected).toBe(true);
        expect(nodes.filter((node) => node.selected === true)).toHaveLength(1);
    });

    it('clears the selection when an unselect is reported with nothing replacing it', () => {
        renderGraph();
        emitNodeChanges([{ type: 'select', id: '3', selected: true }]);

        // Escape on the focused node, which React Flow turns into a bare unselect.
        emitNodeChanges([{ type: 'select', id: '3', selected: false }]);

        expect(lastFlowRender().nodes.some((node) => node.selected === true)).toBe(false);
    });

    it('keeps select changes out of the node array so selection has one source', () => {
        renderGraph();
        applyNodeChanges.mockClear();

        emitNodeChanges([
            { type: 'select', id: '3', selected: true },
            { type: 'position', id: '3', position: { x: 1, y: 2 } },
        ]);

        expect(applyNodeChanges).toHaveBeenCalledTimes(1);
        expect(applyNodeChanges).toHaveBeenCalledWith([{ type: 'position', id: '3', position: { x: 1, y: 2 } }]);
    });

    it('forwards a drag frame without rebuilding the change array', () => {
        renderGraph();
        applyNodeChanges.mockClear();
        const changes: NodeChange<OpGraphFlowNode>[] = [{ type: 'position', id: '1', position: { x: 3, y: 4 } }];

        emitNodeChanges(changes);

        expect(applyNodeChanges).toHaveBeenCalledWith(changes);
    });
});

describe('OperationGraphReactFlow filter dimming', () => {
    it('marks the matched set and leaves the rest of the elements untouched', () => {
        renderGraph();

        typeFilter('matmul');

        const { nodes } = lastFlowRender();
        expect(nodeById(nodes, '3').className).toContain('op-graph-node-match');
        expect(nodeById(nodes, '4').className ?? '').not.toContain('op-graph-node-match');
        // The dim itself is the container's job, so nothing should have grown an
        // inline opacity on the way through.
        expect(nodes.every((node) => node.style?.opacity === undefined)).toBe(true);
    });

    it('flags the container so the stylesheet can dim the non-matches', () => {
        const { container } = renderGraph();
        expect(container.querySelector('.op-graph-filtering')).toBeNull();

        typeFilter('matmul');

        expect(container.querySelector('.op-graph-filtering')).not.toBeNull();
    });

    it('keeps non-matching nodes byte-for-byte across a drag frame', () => {
        renderGraph();
        typeFilter('matmul');
        const before = lastFlowRender().nodes;

        // What React Flow hands back mid-drag: a new array, a new object for the
        // node under the pointer, and the other several hundred untouched. Any
        // per-non-match styling turns that into a full re-render of the canvas.
        act(() => {
            harness.setNodes?.((previous) =>
                previous.map((node) => (node.id === '1' ? { ...node, position: { x: 5, y: 5 } } : node)),
            );
        });

        const after = lastFlowRender().nodes;
        expect(after).not.toBe(before);
        expect(nodeById(after, '4')).toBe(nodeById(before, '4'));
        expect(nodeById(after, '5')).toBe(nodeById(before, '5'));
    });
});
