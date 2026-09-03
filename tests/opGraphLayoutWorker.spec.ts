// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeviceNodeId } from '../src/components/operation-graph/opGraphDeviceSubgraph';
import {
    type OpGraphBuildOptions,
    type OpGraphBuiltGraph,
    type OpGraphDeviceSubgraph,
    OpGraphGrouping,
    type OpGraphSourceOperation,
    type OpGraphWorkerInboundMessage,
    OpGraphWorkerMessageType,
    type OpGraphWorkerOutboundMessage,
} from '../src/components/operation-graph/opGraphTypes';

// Stubbed so a test can count layouts, which is what coalescing and the cache are
// both about. The builder's own behaviour is covered by opGraphBuilder.spec.ts.
const buildOpGraph = vi.hoisted(() =>
    vi.fn<(operations: OpGraphSourceOperation[], options: OpGraphBuildOptions) => OpGraphBuiltGraph>(),
);

// `collectCandidateEdges` is counted, not stubbed away: the worker is supposed to
// run it once per source and share the result between detection and the build.
const collectCandidateEdges = vi.fn(() => []);

vi.mock('../src/components/operation-graph/opGraphBuilder', () => ({
    buildOpGraph,
    collectCandidateEdges,
    getKeptOperations: (operations: OpGraphSourceOperation[]) => operations,
}));

const OPERATIONS: OpGraphSourceOperation[] = [
    {
        id: 1,
        name: 'matmul',
        fileIdentifier: 'model.py:1',
        outputs: [{ edgeLabel: '[1, 32]', consumers: [2], tensorId: 10 }],
        deviceOperationCount: 0,
    },
    { id: 2, name: 'add', fileIdentifier: 'model.py:2', outputs: [], deviceOperationCount: 0 },
];

const posted: OpGraphWorkerOutboundMessage[] = [];

type WorkerHandler = (event: MessageEvent<OpGraphWorkerInboundMessage>) => void;
type Send = (message: OpGraphWorkerInboundMessage) => void;

// The worker installs itself on the global `onmessage`, so a test drives it by
// calling that. Modules are reset per test because the queue, the cache and the
// source version are all module-level state.
const loadWorker = async (): Promise<Send> => {
    vi.resetModules();
    await import('../src/components/operation-graph/opGraphLayoutWorker');
    // The worker's bare `onmessage = ` assignment lands on the jsdom global, whose
    // handler slot is typed for a `Window` receiver a worker doesn't have; the read
    // is narrowed to what a caller actually needs.
    const handler = window.onmessage as unknown as WorkerHandler | null;
    if (handler === null) {
        throw new Error('worker did not install an onmessage handler');
    }
    return (message) => handler({ data: message } as MessageEvent<OpGraphWorkerInboundMessage>);
};

const setGraph = (sourceVersion: number): OpGraphWorkerInboundMessage => ({
    type: OpGraphWorkerMessageType.SET_GRAPH,
    sourceVersion,
    operations: OPERATIONS,
});

// Only `operationId` reaches the cache key, so the rest of the payload is the
// minimum that satisfies the type.
const expansionOf = (...operationIds: number[]): OpGraphDeviceSubgraph[] =>
    operationIds.map((operationId) => ({
        operationId,
        nodes: [{ id: getDeviceNodeId(operationId, 1), label: 'HeadDeviceOperation()' }],
        edges: [],
        entryNodeIdByTensorId: {},
        exitNodeIdByTensorId: {},
        entryFallbackNodeId: null,
        exitFallbackNodeId: null,
    }));

const build = (
    requestId: number,
    hideDeallocate: boolean,
    sourceVersion = 1,
    deviceSubgraphs: OpGraphDeviceSubgraph[] = [],
    expandedBlockIds: readonly string[] = [],
): OpGraphWorkerInboundMessage => ({
    type: OpGraphWorkerMessageType.BUILD,
    sourceVersion,
    requestId,
    hideDeallocate,
    deviceSubgraphs,
    expandedBlockIds,
});

const buildWithGrouping = (requestId: number, grouping: OpGraphGrouping): OpGraphWorkerInboundMessage => ({
    type: OpGraphWorkerMessageType.BUILD,
    sourceVersion: 1,
    requestId,
    hideDeallocate: false,
    deviceSubgraphs: [],
    expandedBlockIds: [],
    grouping,
});

const optionsOfLastBuild = () => buildOpGraph.mock.calls.at(-1)?.[1];

const builtReplies = () => posted.filter((message) => message.type === OpGraphWorkerMessageType.BUILT);

const drain = () => vi.advanceTimersByTime(0);

beforeEach(() => {
    posted.length = 0;
    buildOpGraph.mockReset();
    collectCandidateEdges.mockClear();
    // A fresh object per layout, so object identity distinguishes a cache hit
    // from a rebuild that happens to produce an equal graph.
    buildOpGraph.mockImplementation(() => ({ nodes: [], edges: [] }));
    vi.stubGlobal('postMessage', (message: OpGraphWorkerOutboundMessage) => {
        posted.push(message);
    });
    vi.useFakeTimers();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('opGraphLayoutWorker', () => {
    describe('grouping', () => {
        it('hands the build the grouping the view asked for', async () => {
            // The handler used to rebuild the request by listing its fields, and
            // `grouping` was not among them. Every option on `OpGraphBuildOptions` is
            // optional, so the omission type-checked and every build silently ran the
            // default detector while the toolbar showed the mode the user picked. #1976
            const send = await loadWorker();
            send(setGraph(1));

            send(buildWithGrouping(1, OpGraphGrouping.LAYERS));
            drain();

            expect(optionsOfLastBuild()).toEqual(expect.objectContaining({ grouping: OpGraphGrouping.LAYERS }));
        });

        it('carries every option across the message boundary, not a chosen few', async () => {
            // Guards the shape rather than one field: a future option added to the
            // build must not need a second edit here to survive the hop.
            const send = await loadWorker();
            send(setGraph(1));

            send(buildWithGrouping(1, OpGraphGrouping.REPEATS));
            drain();

            expect(optionsOfLastBuild()).toEqual(
                expect.objectContaining({
                    hideDeallocate: false,
                    deviceSubgraphs: [],
                    expandedBlockIds: [],
                    grouping: OpGraphGrouping.REPEATS,
                }),
            );
        });

        it('does not serve the layout of one grouping to the other', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(buildWithGrouping(1, OpGraphGrouping.REPEATS));
            drain();
            send(buildWithGrouping(2, OpGraphGrouping.LAYERS));
            drain();

            // Same source, same fold state: only the detector differs, so a cache key
            // blind to it would hand back the first graph.
            expect(buildOpGraph).toHaveBeenCalledTimes(2);
        });

        it('reuses the layout when the grouping is unchanged', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(buildWithGrouping(1, OpGraphGrouping.LAYERS));
            drain();
            send(buildWithGrouping(2, OpGraphGrouping.LAYERS));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(1);
        });
    });

    describe('coalescing', () => {
        it('lays out once for a burst and answers the newest request', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            // What a drag on the op-range slider looks like: a request per
            // pointer frame, all arriving before the first layout could finish.
            send(build(1, true));
            send(build(2, true));
            send(build(3, true));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(1);
            expect(builtReplies()).toHaveLength(1);
            expect(builtReplies()[0].requestId).toBe(3);
        });

        it('still answers a lone request', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true));
            drain();

            expect(builtReplies().map((message) => message.requestId)).toEqual([1]);
        });

        it('answers each request that arrives in its own turn', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true));
            drain();
            send(build(2, false));
            drain();

            expect(builtReplies().map((message) => message.requestId)).toEqual([1, 2]);
        });

        it('drops a queued build when a new source arrives before it runs', async () => {
            const send = await loadWorker();
            send(setGraph(1));
            send(build(1, true));

            // The view posts SET_GRAPH before the build for the new report, so a
            // build still queued against the old source must not be laid out.
            send(setGraph(2));
            drain();

            expect(buildOpGraph).not.toHaveBeenCalled();
            expect(posted).toHaveLength(0);
        });

        it('skips a build whose source version is already stale', async () => {
            const send = await loadWorker();
            send(setGraph(2));

            send(build(1, true, 1));
            drain();

            expect(buildOpGraph).not.toHaveBeenCalled();
            expect(posted).toHaveLength(0);
        });
    });

    describe('layout cache', () => {
        it('serves a repeated option set without laying it out again', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true));
            drain();
            send(build(2, false));
            drain();
            send(build(3, true));
            drain();

            // Toggling hide-deallocate off and back on is the case this exists
            // for: three replies, two layouts, and the third is the first graph.
            expect(buildOpGraph).toHaveBeenCalledTimes(2);
            const replies = builtReplies();
            expect(replies).toHaveLength(3);
            expect(replies[2].graph).toBe(replies[0].graph);
        });

        // The rest of the request is identical when an operation is expanded, so a
        // key blind to the expansion answers the toggle with the collapsed graph
        // and the box never opens.
        it('does not serve a collapsed layout to an expanded graph', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true));
            drain();
            send(build(2, true, 1, expansionOf(2)));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(2);
            const replies = builtReplies();
            expect(replies[1].graph).not.toBe(replies[0].graph);
        });

        it('tells one expanded set from another', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true, 1, expansionOf(2)));
            drain();
            send(build(2, true, 1, expansionOf(2, 5)));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(2);
        });

        it('serves a collapse back to a set it has already laid out', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true, 1, expansionOf(2)));
            drain();
            send(build(2, true, 1, expansionOf(5)));
            drain();
            send(build(3, true, 1, expansionOf(2)));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(2);
            const replies = builtReplies();
            expect(replies[2].graph).toBe(replies[0].graph);
        });

        it('does not lay out again because two expansions arrived in a different order', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            // The view holds the expanded set in a `Set`, whose iteration order
            // follows insertion, so the same two open boxes reach the worker in
            // whichever order they were opened.
            send(build(1, true, 1, expansionOf(2, 5)));
            drain();
            send(build(2, true, 1, expansionOf(5, 2)));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(1);
        });

        it('does not serve a folded layout to an unrolled graph', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true));
            drain();
            send(build(2, true, 1, [], ['block:0:2']));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(2);
            const replies = builtReplies();
            expect(replies[1].graph).not.toBe(replies[0].graph);
        });

        it('tells one unrolled set from another', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true, 1, [], ['block:0:2']));
            drain();
            send(build(2, true, 1, [], ['block:0:2', 'block:0:4']));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(2);
        });

        it('does not lay out again because two block ids arrived in a different order', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true, 1, [], ['block:0:2', 'block:0:4']));
            drain();
            send(build(2, true, 1, [], ['block:0:4', 'block:0:2']));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(1);
        });

        it('reuses the same detection across fold and unroll', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true));
            drain();
            send(build(2, true, 1, [], ['block:0:2']));
            drain();

            expect(buildOpGraph.mock.calls[0][1].detectedBlocks).toBe(buildOpGraph.mock.calls[1][1].detectedBlocks);
        });

        it('serves a fold back to a set it has already laid out', async () => {
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true, 1, [], ['block:0:2']));
            drain();
            send(build(2, true, 1, [], ['block:0:4']));
            drain();
            send(build(3, true, 1, [], ['block:0:2']));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(2);
            const replies = builtReplies();
            expect(replies[2].graph).toBe(replies[0].graph);
        });

        it('does not reuse one report’s detection for another', async () => {
            // The detection cache was keyed on `hideDeallocate` alone and relied
            // entirely on the SET_GRAPH clear. If that clear is ever moved or
            // missed, report B folds using report A’s instances, whose member op
            // ids exist in B but mean unrelated operations.
            const send = await loadWorker();
            send(setGraph(1));
            send(build(1, true));
            drain();

            send(setGraph(2));
            send(build(2, true, 2));
            drain();

            expect(buildOpGraph.mock.calls[1][1].detectedBlocks).not.toBe(buildOpGraph.mock.calls[0][1].detectedBlocks);
        });

        it('collects candidate edges once per source, not once per build', async () => {
            // An ops x outputs x consumers walk that detection and the build both
            // need; it ran two to three times per build before.
            const send = await loadWorker();
            send(setGraph(1));

            send(build(1, true));
            drain();
            send(build(2, true, 1, [], ['block:0:2']));
            drain();

            expect(collectCandidateEdges).toHaveBeenCalledTimes(1);

            send(setGraph(2));
            send(build(3, true, 2));
            drain();

            expect(collectCandidateEdges).toHaveBeenCalledTimes(2);
        });

        it('does not serve one report\u2019s layout for another', async () => {
            const send = await loadWorker();
            send(setGraph(1));
            send(build(1, true));
            drain();

            send(setGraph(2));
            send(build(2, true, 2));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(2);
            const replies = builtReplies();
            expect(replies[1].graph).not.toBe(replies[0].graph);
        });
    });

    describe('failures', () => {
        it('reports a failed layout against the request that asked for it', async () => {
            const send = await loadWorker();
            send(setGraph(1));
            buildOpGraph.mockImplementation(() => {
                throw new Error('dagre exploded');
            });

            send(build(7, true));
            drain();

            expect(posted).toEqual([{ type: OpGraphWorkerMessageType.ERROR, requestId: 7, error: 'dagre exploded' }]);
        });

        it('does not cache a failed layout', async () => {
            const send = await loadWorker();
            send(setGraph(1));
            buildOpGraph.mockImplementationOnce(() => {
                throw new Error('dagre exploded');
            });

            send(build(1, true));
            drain();
            send(build(2, true));
            drain();

            expect(buildOpGraph).toHaveBeenCalledTimes(2);
            expect(builtReplies()).toHaveLength(1);
        });
    });
});
