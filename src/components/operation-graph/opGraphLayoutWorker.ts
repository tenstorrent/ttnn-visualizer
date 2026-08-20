// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { touchLruCache } from '../../functions/touchLruCache';
import { buildOpGraph } from './opGraphBuilder';
import {
    type OpGraphBuildOptions,
    type OpGraphBuiltGraph,
    type OpGraphDeviceSubgraph,
    type OpGraphSourceOperation,
    type OpGraphWorkerInboundMessage,
    OpGraphWorkerMessageType,
} from './opGraphTypes';

// The op-range slider drives builds from Blueprint's continuous `onChange`, so
// requests arrive per pointer frame while Dagre takes 43ms on a typical report
// and seconds on a large one. Only the newest request of a burst is ever built;
// the rest are dropped unbuilt, which is safe because the view is only listening
// for its own newest request id anyway.
let pendingBuild: ({ requestId: number; sourceVersion: number } & OpGraphBuildOptions) | null = null;
let isDrainScheduled = false;

// Expansion makes the option space combinatorial rather than a single boolean, so
// the cache now earns its keep on the walk back out of a subgraph. Each entry
// holds a fully laid-out graph, which is what keeps this in the tens.
const LAYOUT_CACHE_LIMIT = 16;
const layoutCache = new Map<string, OpGraphBuiltGraph>();

let sourceVersion = -1;
let operations: OpGraphSourceOperation[] = [];

// Keyed on the source version as well as the options. The `SET_GRAPH` clear is
// what frees the previous report's graphs, but keying on the version too means a
// stale entry can never be served if that clear is ever moved or missed.
//
// Expanded ids are sorted so the key describes the set rather than the order it
// was clicked in: opening A then B is the same graph as opening B then A.
const cacheKeyOf = (version: number, hideDeallocate: boolean, deviceSubgraphs: OpGraphDeviceSubgraph[]): string => {
    const expanded = deviceSubgraphs
        .map((subgraph) => subgraph.operationId)
        .sort((left, right) => left - right)
        .join(',');
    return `${version}:${hideDeallocate}:${expanded}`;
};

const postError = (requestId: number, error: unknown): void => {
    postMessage({
        type: OpGraphWorkerMessageType.ERROR,
        requestId,
        error: error instanceof Error ? error.message : String(error),
    });
};

// Runs one build for whatever the newest pending request is by the time it fires.
// Nothing can arrive mid-build — the worker is single-threaded and `buildOpGraph`
// never yields — so the request read here is the one that gets answered.
const drainPendingBuild = (): void => {
    isDrainScheduled = false;
    const request = pendingBuild;
    pendingBuild = null;
    if (request === null) {
        return;
    }

    // The view also discards mismatched replies; bailing here skips the layout.
    if (request.sourceVersion !== sourceVersion) {
        return;
    }

    const cacheKey = cacheKeyOf(request.sourceVersion, request.hideDeallocate, request.deviceSubgraphs);
    const cached = layoutCache.get(cacheKey);
    if (cached) {
        touchLruCache(layoutCache, cacheKey, cached, LAYOUT_CACHE_LIMIT);
        postMessage({
            type: OpGraphWorkerMessageType.BUILT,
            sourceVersion: request.sourceVersion,
            requestId: request.requestId,
            graph: cached,
        });
        return;
    }

    try {
        const graph = buildOpGraph(operations, {
            hideDeallocate: request.hideDeallocate,
            deviceSubgraphs: request.deviceSubgraphs,
        });
        touchLruCache(layoutCache, cacheKey, graph, LAYOUT_CACHE_LIMIT);
        postMessage({
            type: OpGraphWorkerMessageType.BUILT,
            sourceVersion: request.sourceVersion,
            requestId: request.requestId,
            graph,
        });
    } catch (error) {
        postError(request.requestId, error);
    }
};

onmessage = (event: MessageEvent<OpGraphWorkerInboundMessage>) => {
    const message = event.data;

    if (message.type === OpGraphWorkerMessageType.SET_GRAPH) {
        sourceVersion = message.sourceVersion;
        operations = message.operations;
        layoutCache.clear();
        // A build queued against the previous source is moot; the view reissues
        // one for the new source as part of the same change.
        pendingBuild = null;
        return;
    }

    pendingBuild = {
        requestId: message.requestId,
        sourceVersion: message.sourceVersion,
        hideDeallocate: message.hideDeallocate,
        deviceSubgraphs: message.deviceSubgraphs,
    };

    if (!isDrainScheduled) {
        isDrainScheduled = true;
        // A task hop rather than a microtask, and this is the whole coalescing
        // mechanism: message events are tasks, so yielding lets every request
        // already queued behind this one arrive and overwrite `pendingBuild`
        // before Dagre starts. A microtask would run first and build the oldest
        // request of the burst, then the next, then the next.
        setTimeout(drainPendingBuild, 0);
    }
};
