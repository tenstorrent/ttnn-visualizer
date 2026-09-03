// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';

import type { NodeChange } from '@xyflow/react';

import { type DeviceOperationNode, type Node, NodeType, type OperationDescription } from '../src/model/APIData';
import type {
    OpGraphBuildOptions,
    OpGraphBuiltGraph,
    OpGraphDeviceSubgraph,
    OpGraphFlowEdge,
    OpGraphFlowNode,
    OpGraphSourceOperation,
} from '../src/components/operation-graph/opGraphTypes';
import { OpGraphGrouping } from '../src/components/operation-graph/opGraphTypes';

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
    setEdges: ((updater: (previous: OpGraphFlowEdge[]) => OpGraphFlowEdge[]) => void) | null;
    onNodeClick: ((event: unknown, node: OpGraphFlowNode) => void) | null;
    onNodeDoubleClick: ((event: unknown, node: OpGraphFlowNode) => void) | null;
    onNodesChange: ((changes: NodeChange<OpGraphFlowNode>[]) => void) | null;
    // Left as `undefined` by the view when the overlay is off, which is the gating
    // a test can only see by reading the prop React Flow was actually handed.
    onNodeMouseEnter: ((event: unknown, node: OpGraphFlowNode) => void) | undefined;
    onNodeMouseLeave: (() => void) | undefined;
    onPaneClick: (() => void) | null;
    // What the view actually derived from `operationList`. Builds run against this
    // rather than a reimplementation, so a field the mapping stops carrying fails
    // here instead of silently changing what detection fingerprints on.
    sourceOperations: OpGraphSourceOperation[] | null;
} = {
    onBuilt: null,
    sourceOperations: null,
    setNodes: null,
    setEdges: null,
    onNodeClick: null,
    onNodeDoubleClick: null,
    onNodesChange: null,
    onNodeMouseEnter: undefined,
    onNodeMouseLeave: undefined,
    onPaneClick: null,
};

// What `useNodesState` hands the view as its change applier. Stable, because the
// view's own handler lists it as a dependency.
const applyNodeChanges = vi.fn();

// A real subscriber list. The zoom effect's entire contract is what it writes when
// the store publishes, so a `subscribe` that never invoked its callback left both
// the initial write and the subscription itself impossible to falsify.
const flowTransform: { current: [number, number, number] } = { current: [0, 0, 1] };

// Real spies rather than inert stubs: the viewport anchor is the mechanism this
// branch extends, and it was unobservable. `knownNodeIds` is populated by every
// delivered graph so `getNode` can tell a live id from a stale one. Hoisted
// because the `@xyflow/react` factory below is, and it reads them eagerly.
const { setCenter, setViewport, knownNodeIds } = vi.hoisted(() => ({
    setCenter: vi.fn(() => Promise.resolve()),
    setViewport: vi.fn(() => Promise.resolve()),
    knownNodeIds: new Set<string>(),
}));
const flowStoreListeners = new Set<(state: { transform: [number, number, number] }) => void>();

vi.mock('@xyflow/react', async () => {
    const { useState, createElement, Fragment } = await import('react');
    const Passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
    // Stable across renders: the real `useReactFlow` returns a stable API object,
    // and an unstable one here would invalidate the callbacks whose stability the
    // rebuild effect depends on, quietly weakening every assertion below.
    const flowApi = {
        setCenter,
        // `undefined` for an id the graph does not hold, which is the whole point
        // of the `nodeId ?? fallbackNodeId` fallback: the anchor id flips between a
        // block id and its first member id across a fold, and a getNode that
        // answered for any id at all made that fallback unfalsifiable.
        getNode: (id: string) =>
            knownNodeIds.has(id) ? { id, position: { x: 0, y: 0 }, width: 100, height: 40 } : undefined,
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        setViewport,
    };
    // Stable like `flowApi`: the zoom effect lists the store as a dependency, so
    // a fresh object per render would resubscribe on every pass.
    const flowStoreApi = {
        getState: () => ({ transform: flowTransform.current }),
        subscribe: (listener: (state: { transform: [number, number, number] }) => void) => {
            flowStoreListeners.add(listener);
            return () => flowStoreListeners.delete(listener);
        },
    };
    return {
        ReactFlow: ({
            nodes,
            edges,
            nodeTypes,
            onNodeClick,
            onNodeDoubleClick,
            onNodesChange,
            onNodeMouseEnter,
            onNodeMouseLeave,
            onPaneClick,
            children,
        }: {
            nodes: OpGraphFlowNode[];
            edges: OpGraphFlowEdge[];
            nodeTypes?: Record<
                string,
                (props: { id: string; data: OpGraphFlowNode['data']; type?: string }) => ReactNode
            >;
            onNodeClick: (event: unknown, node: OpGraphFlowNode) => void;
            onNodeDoubleClick?: (event: unknown, node: OpGraphFlowNode) => void;
            onNodesChange: (changes: NodeChange<OpGraphFlowNode>[]) => void;
            onNodeMouseEnter?: (event: unknown, node: OpGraphFlowNode) => void;
            onNodeMouseLeave?: () => void;
            onPaneClick?: () => void;
            children?: ReactNode;
        }) => {
            flowRenders.push({ nodes, edges });
            harness.onNodeClick = onNodeClick;
            harness.onNodeDoubleClick = onNodeDoubleClick ?? null;
            harness.onNodesChange = onNodesChange;
            harness.onNodeMouseEnter = onNodeMouseEnter;
            harness.onNodeMouseLeave = onNodeMouseLeave;
            harness.onPaneClick = onPaneClick ?? null;
            return createElement(
                Fragment,
                null,
                nodes.map((node) => {
                    const NodeComponent = node.type === undefined ? undefined : nodeTypes?.[node.type];
                    return NodeComponent === undefined
                        ? null
                        : createElement(NodeComponent, {
                              key: node.id,
                              id: node.id,
                              data: node.data,
                              type: node.type,
                          });
                }),
                children ?? null,
            );
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
            harness.setEdges = setValue;
            return [value, setValue, () => {}];
        },
        useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
            selector({ transform: flowTransform.current }),
    };
});

vi.mock('../src/components/operation-graph/useOpGraphLayoutWorker', () => ({
    useOpGraphLayoutWorker: (operations: OpGraphSourceOperation[], onBuilt: (graph: OpGraphBuiltGraph) => void) => {
        harness.sourceOperations = operations;
        harness.onBuilt = (graph) => {
            knownNodeIds.clear();
            for (const node of graph.nodes) {
                knownNodeIds.add(node.id);
            }
            onBuilt(graph);
        };
        return { runBuild, isBuilding: false };
    },
}));

// Wraps the real traversal instead of replacing it: the rendering assertions need
// the true path, and one assertion needs to count how often it is computed.
vi.mock('../src/components/operation-graph/opGraphCriticalPath', async () => {
    const actual = await vi.importActual<typeof import('../src/components/operation-graph/opGraphCriticalPath')>(
        '../src/components/operation-graph/opGraphCriticalPath',
    );
    return { ...actual, findCriticalPath: vi.fn(actual.findCriticalPath) };
});

// Imported after the `vi.mock` factories so the stubs are registered first. The
// builder is the real one: the identity assertions below only mean something
// against the node shapes production actually produces.
/* eslint-disable import/first */
import { buildOpGraph } from '../src/components/operation-graph/opGraphBuilder';
import { findCriticalPath } from '../src/components/operation-graph/opGraphCriticalPath';
import {
    countDeviceOperations,
    getDeviceEdgeId,
    getDeviceNodeId,
} from '../src/components/operation-graph/opGraphDeviceSubgraph';
import OperationGraphReactFlow from '../src/components/operation-graph/OperationGraphReactFlow';
import {
    PERF_BAR_COLOR_VAR,
    PERF_BAR_SCALE_VAR,
    PERF_BAR_ZOOM_VAR,
} from '../src/components/operation-graph/opGraphPerfOverlay';
import { NO_PERF_DATA_LABEL } from '../src/definitions/PerfOverlayStatus';
import { formatDuration } from '../src/functions/formatting';
import type { PerfOverlaySource } from '../src/functions/perfOverlay';
import { activePerformanceReportAtom, activeProfilerReportAtom, criticalPathScopeAtom } from '../src/store/app';
import type { ReportFolder } from '../src/definitions/Reports';
/* eslint-enable import/first */

const FILTER_DEBOUNCE_MS = 120;

const operation = (
    id: number,
    name: string,
    consumers: number[],
    fileIdentifier = `model.py:${id}`,
): OperationDescription =>
    ({
        id,
        name,
        operationFileIdentifier: fileIdentifier,
        // Tensor ids matter once an operation expands: they are how an edge finds
        // the device operation at the far end of the boundary.
        outputs: [{ id: id * 10, shape: 'Shape([1, 32])', consumers }],
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
        outputs: op.outputs.map((tensor) => ({
            edgeLabel: '[1, 32]',
            consumers: tensor.consumers,
            tensorId: tensor.id,
        })),
        deviceOperationCount: countDeviceOperations(op),
    }));

const renderGraph = (operations = OPERATION_LIST, perfRows?: PerfOverlaySource[]) => {
    const view = render(
        <MemoryRouter>
            <OperationGraphReactFlow
                operationList={operations}
                perfRows={perfRows}
                isPerfReportLoaded={perfRows !== undefined}
            />
        </MemoryRouter>,
    );
    // The worker is stubbed, so the view only receives a graph when a test says
    // so; this is the reply the mount's own `runBuild` would have produced.
    act(() => {
        harness.onBuilt?.(
            buildOpGraph(harness.sourceOperations ?? sourceFor(operations), {
                hideDeallocate: true,
                deviceSubgraphs: [],
            }),
        );
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

const hoverNode = (id: string) => {
    act(() => {
        harness.onNodeMouseEnter?.({ clientX: 20, clientY: 30 }, nodeById(lastFlowRender().nodes, id));
    });
};

const PERF_ROWS: PerfOverlaySource[] = OPERATION_LIST.map((op) => ({ id: op.id, device_time: op.id * 10 }));

// Two routes from op 1 to op 4, so the graph has ops on the path and ops beside
// it. `OPERATION_LIST` is a chain, which puts every node on the path and would let
// an unconditionally applied highlight pass every assertion below.
const BRANCHING_OPERATION_LIST: OperationDescription[] = [
    operation(1, 'entry_a', [2, 3]),
    operation(2, 'quick_b', [4]),
    operation(3, 'slow_c', [4]),
    operation(4, 'exit_d', []),
];

// 1 → 3 → 4 costs 120ns against the 25ns of 1 → 2 → 4, so op 2 is the one op the
// highlight must leave alone.
const BRANCHING_PERF_ROWS: PerfOverlaySource[] = [
    { id: 1, device_time: 10 },
    { id: 2, device_time: 5 },
    { id: 3, device_time: 100 },
    { id: 4, device_time: 10 },
];

const edgeBetween = (edges: OpGraphFlowEdge[], source: string, target: string) => {
    const found = edges.find((edge) => edge.source === source && edge.target === target);
    expect(found, `edge ${source} → ${target} missing`).toBeDefined();
    return found as OpGraphFlowEdge;
};

// By the operations the edge joins, which reads the same whether an end renders
// collapsed or as a device operation inside an expanded box.
const edgeJoining = (edges: OpGraphFlowEdge[], source: number, target: number) => {
    const found = edges.find(
        (edge) => edge.data?.sourceOperationId === source && edge.data?.targetOperationId === target,
    );
    expect(found, `edge ${source} → ${target} missing`).toBeDefined();
    return found as OpGraphFlowEdge;
};

// Two device operations named so a filter would match them if children ever
// entered the match set, entered on the tensor `producerId` handed down and left
// on the expanded operation's own output tensor.
const deviceSubgraphFor = (operationId: number, producerId: number): OpGraphDeviceSubgraph => {
    const head = getDeviceNodeId(operationId, 1);
    const tail = getDeviceNodeId(operationId, 2);
    return {
        operationId,
        nodes: [
            { id: head, label: 'matmul_head_device_op()' },
            { id: tail, label: 'matmul_tail_device_op()' },
        ],
        edges: [{ id: getDeviceEdgeId(operationId, 1, 2, 9), source: head, target: tail, label: 'T9 [1, 32]' }],
        entryNodeIdByTensorId: { [producerId * 10]: head },
        exitNodeIdByTensorId: { [operationId * 10]: tail },
        entryFallbackNodeId: head,
        exitFallbackNodeId: tail,
    };
};

// What the worker replies with once a box is open. Overlay-invariant tests still
// inject the graph this way so they don't depend on the click path.
const rebuildWith = (operations: OperationDescription[], deviceSubgraphs: OpGraphDeviceSubgraph[]) => {
    act(() => {
        harness.onBuilt?.(
            buildOpGraph(harness.sourceOperations ?? sourceFor(operations), {
                hideDeallocate: true,
                deviceSubgraphs,
            }),
        );
    });
};

const tensorNode = (tensorId: number): Node =>
    ({
        id: tensorId,
        node_type: NodeType.tensor,
        params: { tensor_id: tensorId, shape: 'Shape([1, 32])' },
        connections: [],
        inputs: [],
        outputs: [],
        stacking_level: 0,
    }) as unknown as Node;

const deviceFrames = (...names: string[]): DeviceOperationNode[] =>
    names.map((name, index) => {
        const id = index + 1;
        return {
            id,
            node_type: NodeType.function_start,
            params: { name },
            inputs: index === 0 ? [] : [tensorNode(index)],
            outputs: [tensorNode(id)],
            input_tensors: index === 0 ? [] : [index],
            connections: [],
            arguments: [],
            stack_trace: [],
            stacking_level: 0,
        } as unknown as DeviceOperationNode;
    });

const withDeviceOperations = (op: OperationDescription, names: string[]): OperationDescription =>
    ({ ...op, processedConnections: deviceFrames(...names) }) as OperationDescription;

const hasClass = (element: { className?: string }, className: string) =>
    (element.className ?? '').split(' ').includes(className);

const perfScaleOf = (node: OpGraphFlowNode) =>
    (node.style as Record<string, unknown> | undefined)?.[PERF_BAR_SCALE_VAR];

const perfColorOf = (node: OpGraphFlowNode) =>
    (node.style as Record<string, unknown> | undefined)?.[PERF_BAR_COLOR_VAR];

// One store publish, as d3-zoom produces on a wheel frame.
const setFlowZoom = (zoom: number) => {
    flowTransform.current = [0, 0, zoom];
    act(() => {
        flowStoreListeners.forEach((listener) => listener({ transform: flowTransform.current }));
    });
};

// jsdom serialises an inline `background-color` as `rgb(...)`, so the hex the graph
// writes has to go through the same normalisation before comparing.
const asRenderedColor = (color: string) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = color;
    return probe.style.backgroundColor;
};

// By role, because the legend the overlay renders carries an `aria-label` that
// starts the same way.
const overlaySwitch = () => screen.getByRole('checkbox', { name: /^Perf overlay/ }) as HTMLInputElement;

const enableOverlay = () => fireEvent.click(overlaySwitch());

const criticalPathSwitch = () => screen.getByRole('checkbox', { name: /^Highlight critical path/ }) as HTMLInputElement;

const enableCriticalPath = () => fireEvent.click(criticalPathSwitch());

beforeEach(() => {
    vi.useFakeTimers();
    runBuild.mockClear();
    applyNodeChanges.mockClear();
    vi.mocked(findCriticalPath).mockClear();
    flowRenders.length = 0;
    harness.onBuilt = null;
    harness.sourceOperations = null;
    setCenter.mockClear();
    setViewport.mockClear();
    knownNodeIds.clear();
    harness.setNodes = null;
    harness.setEdges = null;
    harness.onNodeClick = null;
    harness.onNodeDoubleClick = null;
    harness.onNodesChange = null;
    harness.onNodeMouseEnter = undefined;
    harness.onNodeMouseLeave = undefined;
    harness.onPaneClick = null;
    flowTransform.current = [0, 0, 1];
    flowStoreListeners.clear();
    sessionStorage.clear();
    // No `Provider` here, so the view reads the default store and report state
    // would otherwise carry into the next test.
    getDefaultStore().set(activePerformanceReportAtom, null);
    getDefaultStore().set(activeProfilerReportAtom, null);
    // Scoping makes critical-path intent inert against a different report, but two
    // tests using the same fixture paths are the same scope, so it still needs
    // clearing.
    getDefaultStore().set(criticalPathScopeAtom, null);
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
        expect(runBuild).toHaveBeenLastCalledWith({
            hideDeallocate: false,
            deviceSubgraphs: [],
            expandedBlockIds: undefined,
            grouping: OpGraphGrouping.REPEATS,
        });
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

describe('OperationGraphReactFlow perf overlay identity', () => {
    // The overlay patches every linked node rather than the handful a filter or a
    // selection touches, so it is the case where re-dressing nodes per render
    // costs a full canvas re-render instead of a few nodes.
    it('keeps untouched nodes byte-for-byte across a drag frame', () => {
        renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();
        const before = lastFlowRender().nodes;
        // Without this the drag assertion below would pass on an overlay that
        // never applied anything.
        expect(perfScaleOf(nodeById(before, '4'))).toBeDefined();

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

    it('re-dresses the nodes when the scores themselves change', () => {
        const { rerender } = renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();
        const before = lastFlowRender().nodes;

        rerender(
            <MemoryRouter>
                <OperationGraphReactFlow
                    operationList={OPERATION_LIST}
                    perfRows={PERF_ROWS.map((row) => ({ ...row, device_time: (row.device_time ?? 0) * 100 }))}
                    isPerfReportLoaded
                />
            </MemoryRouter>,
        );

        // The cache is keyed on the patch identity, so a new ramp has to reach
        // React Flow even though the node objects behind it never changed.
        expect(nodeById(lastFlowRender().nodes, '4')).not.toBe(nodeById(before, '4'));
    });
});

// Intent is scoped to the report it was enabled for, and the switch reads derived
// active state, so the reset has to clear intent itself rather than rely on the
// overlay going quiet. The rows stay linked throughout, which is what makes the
// switch a faithful read of intent here.
describe('OperationGraphReactFlow perf overlay report scope', () => {
    const reportFolder = (name: string) => ({ path: `/reports/${name}`, reportName: name }) as ReportFolder;

    const setReport = (atom: typeof activeProfilerReportAtom, report: ReportFolder | null) => {
        act(() => {
            getDefaultStore().set(atom, report);
        });
    };

    it('drops the overlay when the profiler report changes', () => {
        renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();
        expect(overlaySwitch().checked).toBe(true);

        setReport(activeProfilerReportAtom, reportFolder('resnet50'));

        expect(overlaySwitch().checked).toBe(false);
    });

    it('drops the overlay when the performance report changes', () => {
        // A perf swap is the more dangerous of the two: the graph is unchanged, so
        // a stale overlay looks plausible while encoding a different run.
        renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();

        setReport(activePerformanceReportAtom, reportFolder('resnet50-perf'));

        expect(overlaySwitch().checked).toBe(false);
        // The encoding has to go with it, not just the control.
        expect(perfScaleOf(nodeById(lastFlowRender().nodes, '4'))).toBeUndefined();
    });

    it('does not re-enable itself when a report is swapped back', () => {
        const first = reportFolder('resnet50');
        renderGraph(OPERATION_LIST, PERF_ROWS);
        setReport(activeProfilerReportAtom, first);
        enableOverlay();
        setReport(activeProfilerReportAtom, reportFolder('bert'));

        expect(overlaySwitch().checked).toBe(false);

        setReport(activeProfilerReportAtom, first);

        expect(overlaySwitch().checked).toBe(false);
    });

    it('leaves the overlay alone while the reports hold still', () => {
        // A reset firing on every render would make the switch unusable.
        const report = reportFolder('resnet50');
        renderGraph(OPERATION_LIST, PERF_ROWS);
        setReport(activeProfilerReportAtom, report);
        enableOverlay();
        setReport(activeProfilerReportAtom, report);

        expect(overlaySwitch().checked).toBe(true);
    });

    it('survives the same report arriving as a rebuilt object', () => {
        // Restoring an instance or refetching writes a fresh `ReportFolder` for the
        // report already loaded, which reference equality read as a swap.
        renderGraph(OPERATION_LIST, PERF_ROWS);
        setReport(activeProfilerReportAtom, reportFolder('resnet50'));
        enableOverlay();
        setReport(activeProfilerReportAtom, reportFolder('resnet50'));

        expect(overlaySwitch().checked).toBe(true);
    });
});

// The SCSS divides the bar's floor by this property to hold an on-screen size at
// overview zoom. `opGraphPerfBarStyles.spec.ts` asserts the stylesheet reads it;
// these assert something writes it, so the compensation cannot go dead silently.
describe('OperationGraphReactFlow perf bar zoom compensation', () => {
    const graphRoot = (container: HTMLElement) =>
        container.querySelector<HTMLElement>('.operation-graph-react-flow') as HTMLElement;

    const publishedZoom = (container: HTMLElement) => graphRoot(container).style.getPropertyValue(PERF_BAR_ZOOM_VAR);

    it('publishes the current zoom when the overlay turns on', () => {
        const { container } = renderGraph(OPERATION_LIST, PERF_ROWS);
        expect(publishedZoom(container)).toBe('');

        enableOverlay();

        expect(publishedZoom(container)).toBe('1');
    });

    it('republishes when a gesture crosses a bucket', () => {
        const { container } = renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();

        setFlowZoom(0.3);

        // Bucketed, so the nearest bucket rather than 0.3 exactly. The contract is
        // the tolerance, not the bucket boundaries.
        const published = Number(publishedZoom(container));
        expect(published).toBeGreaterThan(0.3 * 0.95);
        expect(published).toBeLessThan(0.3 * 1.05);
    });

    it('coalesces sub-bucket frames into a single write', () => {
        const { container } = renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();
        const setProperty = vi.spyOn(graphRoot(container).style, 'setProperty');

        // d3-zoom emits a new scale nearly every frame. The property is inherited by
        // every node's bar, so an unquantised write invalidates style graph-wide per
        // frame — the jank lands at exactly the overview zooms this exists for.
        setFlowZoom(1.01);
        setFlowZoom(1.02);
        setFlowZoom(1.03);

        expect(setProperty).not.toHaveBeenCalled();

        setFlowZoom(1.5);

        expect(setProperty).toHaveBeenCalledTimes(1);
    });

    it('never publishes a zero, which would invalidate the bar geometry', () => {
        // The bar sizes with `calc(2px / var(--op-graph-perf-zoom))`: invalid at 0,
        // so the declaration would drop and the bar vanish at MIN_ZOOM. Absolute
        // quantisation steps round the whole overview range to zero.
        const { container } = renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();

        setFlowZoom(0.02);

        const published = Number(publishedZoom(container));
        expect(published).toBeGreaterThan(0);
        expect(published).toBeLessThan(0.02 * 1.05);
    });

    it('unsubscribes when the overlay is switched off', () => {
        const { container } = renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();
        setFlowZoom(2);
        const lastPublished = publishedZoom(container);

        fireEvent.click(overlaySwitch());
        setFlowZoom(0.5);

        expect(flowStoreListeners.size).toBe(0);
        expect(publishedZoom(container)).toBe(lastPublished);
    });
});

// The panel is the only keyboard-reachable route to the metric, and its props are
// assembled here rather than in the leaf that renders them.
describe('OperationGraphReactFlow perf overlay panel wiring', () => {
    const metricValue = () => screen.getByText('Kernel duration').nextElementSibling as HTMLElement;

    it('hands the selected op its duration and the colour the graph drew it with', () => {
        renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();

        emitNodeChanges([{ type: 'select', id: '4', selected: true }]);

        expect(metricValue()).toHaveTextContent(formatDuration(40_000));
        const swatch = metricValue().querySelector<HTMLElement>('.perf-overlay-op-metric-swatch');
        // Same colour the node carries, so the two encodings cannot disagree.
        const nodeColor = perfColorOf(nodeById(lastFlowRender().nodes, '4'));
        expect(swatch?.style.backgroundColor).toBe(asRenderedColor(String(nodeColor)));
    });

    it('reads no data for an op the perf report never mentioned', () => {
        // Hard-coding the props to `undefined` would make every op in the report
        // read this way with the whole suite still green.
        renderGraph(
            OPERATION_LIST,
            PERF_ROWS.filter((row) => row.id !== 4),
        );
        enableOverlay();

        emitNodeChanges([{ type: 'select', id: '4', selected: true }]);

        expect(metricValue()).toHaveTextContent(NO_PERF_DATA_LABEL);
        expect(metricValue().querySelector('.perf-overlay-op-metric-swatch')).toBeNull();
    });
});

describe('OperationGraphReactFlow perf overlay chrome', () => {
    const legend = () => screen.queryByLabelText('Perf overlay legend');
    const hoverChip = () => document.querySelector<HTMLElement>('.op-graph-perf-hover');

    it('mounts the legend with the linked ops bounds', () => {
        renderGraph(OPERATION_LIST, PERF_ROWS);
        expect(legend()).toBeNull();

        enableOverlay();

        // Bounds come from the aggregate; a legend fed constants would read the
        // same for every report.
        expect(legend()).toHaveTextContent(formatDuration(10_000));
        expect(legend()).toHaveTextContent(formatDuration(50_000));
    });

    it('attaches the hover handler only while the overlay is on', () => {
        renderGraph(OPERATION_LIST, PERF_ROWS);

        expect(harness.onNodeMouseEnter).toBeUndefined();

        enableOverlay();

        expect(harness.onNodeMouseEnter).toBeInstanceOf(Function);
    });

    it('shows the hovered op its duration and rank', () => {
        renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();

        hoverNode('5');

        expect(hoverChip()).toHaveTextContent(`${formatDuration(50_000)} · #1 of 5`);
    });

    it('clears the hover when the pointer leaves', () => {
        renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();
        hoverNode('5');

        act(() => {
            harness.onNodeMouseLeave?.();
        });

        expect(hoverChip()).toBeNull();
    });

    it('drops a hover the overlay left behind when it is switched off', () => {
        // Otherwise it returns, at a stale position, the next time it goes on.
        renderGraph(OPERATION_LIST, PERF_ROWS);
        enableOverlay();
        hoverNode('5');

        fireEvent.click(overlaySwitch());
        enableOverlay();

        expect(hoverChip()).toBeNull();
    });

    it('returns the nodes to the builder objects when the overlay goes off', () => {
        // The identity contract has to survive the round trip, not just the on state.
        renderGraph(OPERATION_LIST, PERF_ROWS);
        const beforeOverlay = lastFlowRender().nodes;
        enableOverlay();
        expect(perfScaleOf(nodeById(lastFlowRender().nodes, '4'))).toBeDefined();

        fireEvent.click(overlaySwitch());

        expect(nodeById(lastFlowRender().nodes, '4')).toBe(nodeById(beforeOverlay, '4'));
    });
});

// Same behaviour as the overlay above, reached differently: intent records the
// reports it was switched on for, so a swap makes it inert immediately and the
// view then clears it. Both halves are worth holding — the first is what keeps a
// stale path off the screen, the second is what stops a swap back reviving it.
// #1613
describe('OperationGraphReactFlow critical path report scope', () => {
    const reportFolder = (name: string) => ({ path: `/reports/${name}`, reportName: name }) as ReportFolder;

    const setReport = (atom: typeof activeProfilerReportAtom, report: ReportFolder | null) => {
        act(() => {
            getDefaultStore().set(atom, report);
        });
    };

    it('drops the highlight when the performance report changes', () => {
        // The weights come from that report, so a stale path is a wrong path drawn
        // with full confidence.
        renderGraph(OPERATION_LIST, PERF_ROWS);
        enableCriticalPath();
        expect(criticalPathSwitch().checked).toBe(true);

        setReport(activePerformanceReportAtom, reportFolder('resnet50-perf'));

        expect(criticalPathSwitch().checked).toBe(false);
    });

    it('drops the highlight when the profiler report changes', () => {
        renderGraph(OPERATION_LIST, PERF_ROWS);
        enableCriticalPath();

        setReport(activeProfilerReportAtom, reportFolder('resnet50'));

        expect(criticalPathSwitch().checked).toBe(false);
    });

    it('does not re-enable itself when a report is swapped back', () => {
        // Scoping alone would leave the intent sitting there, matching again on
        // return; the switch has to come back off, like the overlay's.
        const first = reportFolder('resnet50');
        renderGraph(OPERATION_LIST, PERF_ROWS);
        setReport(activeProfilerReportAtom, first);
        enableCriticalPath();
        setReport(activeProfilerReportAtom, reportFolder('bert'));
        expect(criticalPathSwitch().checked).toBe(false);

        setReport(activeProfilerReportAtom, first);

        expect(criticalPathSwitch().checked).toBe(false);
    });

    it('leaves the highlight alone while the reports hold still', () => {
        const report = reportFolder('resnet50');
        renderGraph(OPERATION_LIST, PERF_ROWS);
        setReport(activeProfilerReportAtom, report);
        enableCriticalPath();
        setReport(activeProfilerReportAtom, reportFolder('resnet50'));

        // A rebuilt-but-equivalent `ReportFolder` is the same scope: the atom holds
        // paths, not object identity.
        expect(criticalPathSwitch().checked).toBe(true);
    });

    it('ignores intent recorded against a report that is no longer loaded', () => {
        act(() => {
            getDefaultStore().set(criticalPathScopeAtom, { profiler: '/reports/other', performance: null });
        });

        renderGraph(OPERATION_LIST, PERF_ROWS);

        expect(criticalPathSwitch().checked).toBe(false);
    });
});

// What the switch actually puts on screen. The stylesheet specs assert the cascade
// these classes feed; without the assertions here nothing said the classes reach
// React Flow at all, so deleting the three class pushes and the annotation left
// the suite green. #1613
describe('OperationGraphReactFlow critical path rendering', () => {
    it('marks the ops on the path and leaves the branch beside it alone', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);

        enableCriticalPath();

        const { nodes } = lastFlowRender();
        expect(hasClass(nodeById(nodes, '3'), 'op-graph-node-critical-path')).toBe(true);
        expect(hasClass(nodeById(nodes, '4'), 'op-graph-node-critical-path')).toBe(true);
        expect(hasClass(nodeById(nodes, '2'), 'op-graph-node-critical-path')).toBe(false);
    });

    it('marks the edges the path traverses and not the ones it skips', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);

        enableCriticalPath();

        const { edges } = lastFlowRender();
        expect(hasClass(edgeBetween(edges, '1', '3'), 'op-graph-edge-critical-path')).toBe(true);
        expect(hasClass(edgeBetween(edges, '3', '4'), 'op-graph-edge-critical-path')).toBe(true);
        expect(hasClass(edgeBetween(edges, '1', '2'), 'op-graph-edge-critical-path')).toBe(false);
        expect(hasClass(edgeBetween(edges, '2', '4'), 'op-graph-edge-critical-path')).toBe(false);
    });

    it('flags the container so the stylesheet can dim what is off the path', () => {
        const { container } = renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        expect(container.querySelector('.op-graph-critical-path')).toBeNull();

        enableCriticalPath();

        expect(container.querySelector('.op-graph-critical-path')).not.toBeNull();
    });

    it('summarises the path it drew', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        expect(screen.queryByLabelText('Critical path summary')).toBeNull();

        enableCriticalPath();

        // Three of the four ops, and the total excludes the branch that lost.
        // `device_time` is microseconds, so the 120 on the path is 120_000ns here.
        const summary = screen.getByLabelText('Critical path summary').textContent ?? '';
        expect(summary).toContain('3 ops');
        expect(summary).toContain(formatDuration(120_000));
        // 120 of the 125 total across the four linked ops.
        expect(summary).toContain('96.0% of total kernel duration');
    });

    it('takes every mark back off when switched off', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        enableCriticalPath();

        fireEvent.click(criticalPathSwitch());

        const { nodes, edges } = lastFlowRender();
        expect(nodes.some((node) => hasClass(node, 'op-graph-node-critical-path'))).toBe(false);
        expect(edges.some((edge) => hasClass(edge, 'op-graph-edge-critical-path'))).toBe(false);
        expect(screen.queryByLabelText('Critical path summary')).toBeNull();
    });

    it('does not retraverse the graph when React Flow replaces the edge array', () => {
        // Selecting an edge hands back a fresh array through `applyEdgeChanges`,
        // which cannot change the path — so keying the traversal on that state
        // paid O(V+E) plus a re-map of every edge on each edge click.
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        enableCriticalPath();
        expect(vi.mocked(findCriticalPath)).toHaveBeenCalled();
        vi.mocked(findCriticalPath).mockClear();

        act(() => {
            harness.setEdges?.((previous) => previous.map((edge) => ({ ...edge, selected: true })));
        });

        expect(vi.mocked(findCriticalPath)).not.toHaveBeenCalled();
        // Still drawn: the point is that the answer was reused, not dropped.
        expect(hasClass(edgeBetween(lastFlowRender().edges, '1', '3'), 'op-graph-edge-critical-path')).toBe(true);
    });
});

describe('OperationGraphReactFlow dim unrelated edges', () => {
    it('flags the container so the stylesheet can dim edges off the selection', () => {
        const { container } = renderGraph();
        expect(container.querySelector('.op-graph-dim-unrelated-edges')).toBeNull();

        fireEvent.click(screen.getByLabelText('Dim unrelated edges'));

        expect(container.querySelector('.op-graph-dim-unrelated-edges')).not.toBeNull();
    });

    it('drops the flag when nothing is selected', () => {
        const { container } = renderGraph();
        fireEvent.click(screen.getByLabelText('Dim unrelated edges'));
        expect(container.querySelector('.op-graph-dim-unrelated-edges')).not.toBeNull();

        act(() => {
            harness.onPaneClick?.();
        });

        expect(container.querySelector('.op-graph-dim-unrelated-edges')).toBeNull();
    });
});

// Expanding an operation adds nodes to the same flat array React Flow renders, so
// every feature that walks that array — the perf overlay, the critical path, the
// filter, the neighbour highlight — sees device operations unless it is told not
// to. `nodeIndex` is that telling, and these are the four ways it shows.
describe('OperationGraphReactFlow device operation expansion', () => {
    // Op 3 is the slow op on the winning branch, so absorbing its children as
    // zero-weight operations, or losing an edge to a re-targeted endpoint, both
    // change the answer here rather than only the picture.
    const expandOperationThree = () => rebuildWith(BRANCHING_OPERATION_LIST, [deviceSubgraphFor(3, 1)]);

    it('rebuilds from a click on the expander and collapses on the second', () => {
        const names = ['AlphaDeviceOperation', 'BetaDeviceOperation', 'GammaDeviceOperation'];
        const operations = OPERATION_LIST.map((op) => (op.id === 3 ? withDeviceOperations(op, names) : op));
        renderGraph(operations);
        runBuild.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Show 3 device operations' }));

        const expandedOptions = runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions;
        expect(expandedOptions.deviceSubgraphs).toHaveLength(1);
        expect(expandedOptions.deviceSubgraphs[0].operationId).toBe(3);
        expect(expandedOptions.deviceSubgraphs[0].nodes).toHaveLength(3);

        act(() => {
            harness.onBuilt?.(
                buildOpGraph(sourceFor(operations), {
                    hideDeallocate: true,
                    deviceSubgraphs: expandedOptions.deviceSubgraphs,
                }),
            );
        });

        runBuild.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Hide device operations' }));
        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ deviceSubgraphs: [] }));
    });

    it('does not count device operations as operations on the path', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        enableCriticalPath();
        const collapsed = screen.getByLabelText('Critical path summary').textContent ?? '';

        expandOperationThree();

        expect(screen.getByLabelText('Critical path summary').textContent).toBe(collapsed);
        expect(collapsed).toContain('3 ops');
        expect(collapsed).toContain(formatDuration(120_000));
    });

    it('keeps the path running through an operation whose edges moved inside it', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        enableCriticalPath();

        expandOperationThree();

        const { nodes, edges } = lastFlowRender();
        expect(hasClass(nodeById(nodes, '3'), 'op-graph-node-critical-path')).toBe(true);
        expect(hasClass(edgeJoining(edges, 1, 3), 'op-graph-edge-critical-path')).toBe(true);
        expect(hasClass(edgeJoining(edges, 3, 4), 'op-graph-edge-critical-path')).toBe(true);
        // The edge did move: it now lands on the device operation that consumes
        // the tensor, which is why the marks above cannot be found by endpoint.
        expect(edgeJoining(edges, 1, 3).target).toBe(getDeviceNodeId(3, 1));
    });

    it('leaves the device operations off the path it draws', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        enableCriticalPath();

        expandOperationThree();

        const { nodes, edges } = lastFlowRender();
        expect(hasClass(nodeById(nodes, getDeviceNodeId(3, 1)), 'op-graph-node-critical-path')).toBe(false);
        expect(
            hasClass(edgeBetween(edges, getDeviceNodeId(3, 1), getDeviceNodeId(3, 2)), 'op-graph-edge-critical-path'),
        ).toBe(false);
    });

    it('draws no perf bar on a device operation', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        enableOverlay();

        expandOperationThree();

        const { nodes } = lastFlowRender();
        // The operation keeps the duration; there is nothing to attribute to the
        // frames inside it, and a bar at the default scale would read as "fast".
        expect(perfScaleOf(nodeById(nodes, '3'))).toBeDefined();
        expect(perfScaleOf(nodeById(nodes, getDeviceNodeId(3, 1)))).toBeUndefined();
        expect(perfColorOf(nodeById(nodes, getDeviceNodeId(3, 1)))).toBeUndefined();
    });

    it('does not let a device operation match the filter', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        expandOperationThree();

        // Both device operations inside op 3 are named `matmul_*`, so a counter
        // fed from the rendered nodes would read four.
        typeFilter('matmul');

        expect(screen.queryByText('no matches')).not.toBeNull();
    });

    it('keeps the device operations lit when the operation holding them matches', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        expandOperationThree();

        typeFilter('slow_c');

        // React Flow renders children as siblings, so a child left out of the
        // match set dims inside a lit parent and reads as a rendering fault.
        const { nodes } = lastFlowRender();
        expect(hasClass(nodeById(nodes, '3'), 'op-graph-node-match')).toBe(true);
        expect(hasClass(nodeById(nodes, getDeviceNodeId(3, 1)), 'op-graph-node-match')).toBe(true);
        expect(hasClass(nodeById(nodes, '2'), 'op-graph-node-match')).toBe(false);
    });

    it('highlights the expanded operation as the neighbour, not the device operation', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        expandOperationThree();

        act(() => {
            harness.onNodeClick?.(null, nodeById(lastFlowRender().nodes, '1'));
        });

        const { nodes } = lastFlowRender();
        expect(hasClass(nodeById(nodes, '3'), 'op-graph-node-output')).toBe(true);
        expect(hasClass(nodeById(nodes, getDeviceNodeId(3, 1)), 'op-graph-node-output')).toBe(false);
    });

    it('answers about the operation when a device operation is clicked', () => {
        renderGraph(BRANCHING_OPERATION_LIST, BRANCHING_PERF_ROWS);
        expandOperationThree();

        act(() => {
            harness.onNodeClick?.(null, nodeById(lastFlowRender().nodes, getDeviceNodeId(3, 2)));
        });

        // A frame has no report of its own, so the click selects the operation
        // holding it rather than selecting nothing.
        expect(hasClass(nodeById(lastFlowRender().nodes, '3'), 'op-graph-node-selected')).toBe(true);
    });
});

describe('OperationGraphReactFlow repeat blocks', () => {
    // prefix → (layer_a → layer_b) × 2 → suffix. Two instances of one pattern.
    const REPEAT_OPERATION_LIST: OperationDescription[] = [
        operation(1, 'prefix', [2]),
        operation(2, 'layer_a', [3]),
        operation(3, 'layer_b', [4]),
        operation(4, 'layer_a', [5]),
        operation(5, 'layer_b', [6]),
        operation(6, 'suffix', []),
    ];

    const FIRST_BLOCK_ID = 'block:0:2';
    const SECOND_BLOCK_ID = 'block:0:4';

    const deliver = (operations: OperationDescription[], options: Partial<OpGraphBuildOptions> = {}) => {
        act(() => {
            harness.onBuilt?.(
                buildOpGraph(harness.sourceOperations ?? sourceFor(operations), {
                    hideDeallocate: true,
                    deviceSubgraphs: [],
                    ...options,
                }),
            );
        });
    };

    // Repeats open unrolled, so a test about folded rendering folds first — through
    // the toolbar, so component state and the delivered graph agree. #1977
    const renderFolded = (operations = REPEAT_OPERATION_LIST) => {
        const view = renderGraph(operations);
        fireEvent.click(screen.getByRole('button', { name: 'Fold all repeats' }));
        deliver(operations, { expandedBlockIds: [] });
        return view;
    };

    it('hands the worker every field detection fingerprints on', () => {
        // The fixture used to reimplement this mapping and drop three of its
        // fields, `inputShapes` among them — so every folding assertion in this
        // file ran against a source shape production never emits, and deleting
        // `inputShapes` from the real mapping would have over-folded live graphs
        // with the suite green.
        renderGraph(REPEAT_OPERATION_LIST);

        const mapped = harness.sourceOperations;
        expect(mapped).not.toBeNull();
        expect(mapped).toHaveLength(REPEAT_OPERATION_LIST.length);
        for (const mappedOperation of mapped ?? []) {
            expect(mappedOperation.inputShapes).toBeDefined();
            expect(mappedOperation).toHaveProperty('durationSeconds');
            expect(mappedOperation).toHaveProperty('memoryDeltaBytes');
        }
    });

    it('holds the viewport on an unroll instead of recentring on the selection', () => {
        // The anchor and the selection tween fight for the viewport; the anchor
        // has to win, or the graph jumps to whatever the selection fell back to.
        // Both stubs were inert, so neither half of this was observable. #1944
        renderFolded();
        setCenter.mockClear();
        setViewport.mockClear();

        fireEvent.click(screen.getAllByRole('button', { name: 'Unroll 2 operations' })[0]);
        deliver(REPEAT_OPERATION_LIST, { expandedBlockIds: [FIRST_BLOCK_ID] });

        expect(setViewport).toHaveBeenCalledTimes(1);
        expect(setCenter).not.toHaveBeenCalled();
    });

    it('renders repeats unrolled on first layout and offers Fold', () => {
        renderGraph(REPEAT_OPERATION_LIST);

        expect(lastFlowRender().nodes.map((node) => node.id)).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(screen.getByRole('button', { name: 'Unroll all repeats' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Fold all repeats' })).toBeEnabled();
        expect(screen.queryAllByRole('button', { name: 'Unroll 2 operations' })).toHaveLength(0);
    });

    it('still reports the detections it did not apply, so Fold is offered', () => {
        renderGraph(REPEAT_OPERATION_LIST);

        // The toolbar row is driven by the detections, not by the folded nodes, so an
        // unrolled first layout must still carry them or folding becomes unreachable.
        expect(screen.getByRole('button', { name: 'Fold all repeats' })).toBeInTheDocument();
        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ expandedBlockIds: undefined }));
    });

    it('folds every instance from the toolbar', () => {
        renderFolded();

        expect(lastFlowRender().nodes.map((node) => node.id)).toEqual(['1', FIRST_BLOCK_ID, SECOND_BLOCK_ID, '6']);
        expect(screen.getAllByRole('button', { name: 'Unroll 2 operations' })).toHaveLength(2);
    });

    it('folds only the double-clicked instance, leaving its siblings unrolled', () => {
        // `new Set(null)` is empty, so a naive delete from the unrolled default would
        // fold every instance instead of the one clicked. #1977
        renderGraph(REPEAT_OPERATION_LIST);
        runBuild.mockClear();

        act(() => {
            harness.onNodeDoubleClick?.(null, nodeById(lastFlowRender().nodes, '3'));
        });

        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(
            expect.objectContaining({ expandedBlockIds: [SECOND_BLOCK_ID] }),
        );
    });

    it('does not show the Repeats row when nothing was detected', () => {
        renderGraph();

        expect(screen.queryByRole('button', { name: 'Unroll all repeats' })).toBeNull();
    });

    it('unrolls every instance from the toolbar and folds them back', () => {
        renderFolded();
        runBuild.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Unroll all repeats' }));
        const unrolled = runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions;
        expect(unrolled.expandedBlockIds).toEqual(expect.arrayContaining([FIRST_BLOCK_ID, SECOND_BLOCK_ID]));
        expect(unrolled.expandedBlockIds).toHaveLength(2);

        deliver(REPEAT_OPERATION_LIST, { expandedBlockIds: unrolled.expandedBlockIds });
        expect(lastFlowRender().nodes.map((node) => node.id)).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(screen.getByRole('button', { name: 'Unroll all repeats' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Fold all repeats' })).toBeEnabled();

        runBuild.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Fold all repeats' }));
        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ expandedBlockIds: [] }));
    });

    it('unrolls one instance from its chip', () => {
        renderFolded();
        runBuild.mockClear();

        fireEvent.click(screen.getAllByRole('button', { name: 'Unroll 2 operations' })[0]);
        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(
            expect.objectContaining({ expandedBlockIds: [FIRST_BLOCK_ID] }),
        );
    });

    it('counts a folded block as a visible match when the query hits its label', () => {
        renderFolded();
        typeFilter('layer_a');

        expect(screen.getByText('2 matches')).toBeInTheDocument();
        expect(screen.queryByText(/\+2 inside/)).toBeNull();
    });

    it('counts buried filter matches when the query hits a member but not the label', () => {
        const operations: OperationDescription[] = [
            operation(1, 'prefix', [2]),
            operation(2, 'layer_a', [3], 'attention.py:1'),
            operation(3, 'layer_b', [4], 'mlp.py:1'),
            operation(4, 'layer_a', [5], 'attention.py:2'),
            operation(5, 'layer_b', [6], 'mlp.py:2'),
            operation(6, 'suffix', []),
        ];
        renderFolded(operations);
        typeFilter('layer_a');

        expect(screen.getByText('2 matches (+2 inside)')).toBeInTheDocument();
        expect(screen.getAllByTitle('1 filter match inside')).toHaveLength(2);
        expect(screen.getAllByText('+1')).toHaveLength(2);
    });

    it('opens the block panel instead of the first member when a collapsed block is selected', () => {
        renderFolded();

        act(() => {
            harness.onNodeClick?.(null, nodeById(lastFlowRender().nodes, FIRST_BLOCK_ID));
        });

        const panel = screen.getByLabelText('Selected block details');
        expect(panel).toHaveTextContent('layer_a + layer_b × 2');
        expect(panel).toHaveTextContent('ops 2–3 · instance 1 of 2');
        expect(screen.queryByRole('button', { name: /Memory Details/ })).toBeNull();
        expect(screen.queryByLabelText('Selected operation details')).toBeNull();
    });

    it('does not rebuild when the worker repeats the same block detections', () => {
        const operations = REPEAT_OPERATION_LIST.map((op) =>
            op.id === 1 ? withDeviceOperations(op, ['AlphaDeviceOperation', 'BetaDeviceOperation']) : op,
        );
        renderGraph(operations);
        fireEvent.click(screen.getByRole('button', { name: 'Show 2 device operations' }));
        const expandedOptions = runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions;

        deliver(operations, { deviceSubgraphs: expandedOptions.deviceSubgraphs });
        runBuild.mockClear();
        deliver(operations, { deviceSubgraphs: expandedOptions.deviceSubgraphs });

        expect(runBuild).not.toHaveBeenCalled();
    });

    it('drops a member device-op expansion when that instance is folded', () => {
        const operations = REPEAT_OPERATION_LIST.map((op) =>
            op.id === 2
                ? withDeviceOperations(op, ['AlphaDeviceOperation', 'BetaDeviceOperation', 'GammaDeviceOperation'])
                : op,
        );
        renderFolded(operations);

        fireEvent.click(screen.getByRole('button', { name: 'Unroll all repeats' }));
        const unrolled = runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions;
        deliver(operations, { expandedBlockIds: unrolled.expandedBlockIds });

        fireEvent.click(screen.getByRole('button', { name: 'Show 3 device operations' }));
        const withSubgraph = runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions;
        expect(withSubgraph.deviceSubgraphs).toHaveLength(1);
        expect(withSubgraph.deviceSubgraphs[0].operationId).toBe(2);

        runBuild.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Fold all repeats' }));
        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(
            expect.objectContaining({ deviceSubgraphs: [], expandedBlockIds: [] }),
        );
    });

    it('folds that instance when an unrolled member is double-clicked', () => {
        renderFolded();
        fireEvent.click(screen.getAllByRole('button', { name: 'Unroll 2 operations' })[0]);
        const unrolled = runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions;
        deliver(REPEAT_OPERATION_LIST, { expandedBlockIds: unrolled.expandedBlockIds });

        runBuild.mockClear();
        act(() => {
            harness.onNodeDoubleClick?.(null, nodeById(lastFlowRender().nodes, '3'));
        });

        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ expandedBlockIds: [] }));
    });

    it('folds every instance and drops member device-op expansion when deallocate hiding changes', () => {
        const operations = REPEAT_OPERATION_LIST.map((op) =>
            op.id === 2
                ? withDeviceOperations(op, ['AlphaDeviceOperation', 'BetaDeviceOperation', 'GammaDeviceOperation'])
                : op,
        );
        renderFolded(operations);

        fireEvent.click(screen.getByRole('button', { name: 'Unroll all repeats' }));
        const unrolled = runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions;
        deliver(operations, { expandedBlockIds: unrolled.expandedBlockIds });

        fireEvent.click(screen.getByRole('button', { name: 'Show 3 device operations' }));
        expect((runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions).deviceSubgraphs).toHaveLength(1);

        runBuild.mockClear();
        fireEvent.click(screen.getByLabelText('Hide deallocate ops'));

        // Toggling the filter drops the fold decision as well as the expansions, so
        // the rebuilt graph opens unrolled again rather than folded. #1977
        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(
            expect.objectContaining({ hideDeallocate: false, deviceSubgraphs: [], expandedBlockIds: undefined }),
        );
    });

    it('unrolls the instance that contains the operation the URL names', () => {
        const { rerender } = renderFolded();
        runBuild.mockClear();

        rerender(
            <MemoryRouter>
                <OperationGraphReactFlow
                    operationList={REPEAT_OPERATION_LIST}
                    operationId={3}
                />
            </MemoryRouter>,
        );

        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(
            expect.objectContaining({ expandedBlockIds: [FIRST_BLOCK_ID] }),
        );
    });

    it('forgets unrolled instances when the profiler report changes', () => {
        renderFolded();
        fireEvent.click(screen.getByRole('button', { name: 'Unroll all repeats' }));
        expect((runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions).expandedBlockIds).toHaveLength(2);

        runBuild.mockClear();
        act(() => {
            getDefaultStore().set(activeProfilerReportAtom, {
                path: '/reports/resnet50',
                reportName: 'resnet50',
            } as ReportFolder);
        });

        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ expandedBlockIds: undefined }));
    });

    // No repeated subgraph anywhere in this chain, but two spans whose op names say
    // exactly what they are. It is the case repetition structurally cannot reach. #1976
    const LAYER_OPERATION_LIST: OperationDescription[] = [
        operation(1, 'ttnn.linear', [2]),
        operation(2, 'ttnn.transformer.scaled_dot_product_attention', [3]),
        operation(3, 'ttnn.layer_norm', [4]),
        operation(4, 'ttnn.linear', [5]),
        operation(5, 'ttnn.gelu', [6]),
        operation(6, 'ttnn.layer_norm', []),
    ];

    it('finds nothing to fold by repetition in a graph with no repeats', () => {
        renderGraph(LAYER_OPERATION_LIST);

        expect(screen.getByText('no repeats detected')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Fold all repeats' })).toBeNull();
    });

    it('asks the worker for layer grouping when the mode changes', () => {
        renderGraph(LAYER_OPERATION_LIST);
        runBuild.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Group by layers' }));

        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ grouping: OpGraphGrouping.LAYERS }));
    });

    it('folds semantic spans the repeat scan could not see', () => {
        renderGraph(LAYER_OPERATION_LIST);
        fireEvent.click(screen.getByRole('button', { name: 'Group by layers' }));
        deliver(LAYER_OPERATION_LIST, { grouping: OpGraphGrouping.LAYERS, expandedBlockIds: [] });

        expect(lastFlowRender().nodes.map((node) => node.id)).toEqual(['layer:attention:1', 'layer:feedForward:4']);
        expect(screen.getByRole('button', { name: 'Group by layers' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('applies the grouping the moment it is picked', () => {
        // Leaving the graph unrolled here made the control look broken: both modes
        // rendered identically and the difference only showed after a separate Fold.
        // #1977 governs how a report *opens*; clicking a mode is the ask. #1976
        renderGraph(LAYER_OPERATION_LIST);
        runBuild.mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Group by layers' }));

        expect(runBuild.mock.calls.at(-1)?.[0]).toEqual(
            expect.objectContaining({ grouping: OpGraphGrouping.LAYERS, expandedBlockIds: [] }),
        );
    });

    it("discards the other detector's instance ids when the grouping changes", () => {
        // A kept fold decision would name blocks that do not exist in the new mode.
        renderFolded();
        fireEvent.click(screen.getAllByRole('button', { name: 'Unroll 2 operations' })[0]);
        const unrolled = runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions;
        expect(unrolled.expandedBlockIds).toEqual([FIRST_BLOCK_ID]);

        runBuild.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Group by layers' }));

        expect((runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions).expandedBlockIds).toEqual([]);
    });

    it('shows how many blocks the active detector found', () => {
        // The two strategies are compared by switching, not by folding each and
        // counting nodes on screen.
        renderGraph(REPEAT_OPERATION_LIST);

        expect(screen.getByRole('button', { name: 'Group by repeats' })).toHaveTextContent('Repeats (2)');
        expect(screen.getByRole('button', { name: 'Group by layers' })).toHaveTextContent('Layers');
        expect(screen.getByRole('button', { name: 'Group by layers' })).not.toHaveTextContent('(');
    });

    it('keeps the selection on a folded block when the selected op is a non-first member', () => {
        renderFolded();
        fireEvent.click(screen.getAllByRole('button', { name: 'Unroll 2 operations' })[0]);
        const unrolled = runBuild.mock.calls.at(-1)?.[0] as OpGraphBuildOptions;
        deliver(REPEAT_OPERATION_LIST, { expandedBlockIds: unrolled.expandedBlockIds });

        act(() => {
            harness.onNodeClick?.(null, nodeById(lastFlowRender().nodes, '3'));
        });
        expect(screen.getByLabelText('Selected operation details')).toHaveTextContent('layer_b');

        act(() => {
            harness.onNodeDoubleClick?.(null, nodeById(lastFlowRender().nodes, '3'));
        });
        deliver(REPEAT_OPERATION_LIST, { expandedBlockIds: [] });

        expect(screen.getByLabelText('Selected block details')).toHaveTextContent('layer_a + layer_b × 2');
        expect(hasClass(nodeById(lastFlowRender().nodes, FIRST_BLOCK_ID), 'op-graph-node-selected')).toBe(true);
        expect(hasClass(nodeById(lastFlowRender().nodes, '1'), 'op-graph-node-selected')).toBe(false);
    });
});
