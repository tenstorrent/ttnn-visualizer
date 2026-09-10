// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { touchLruCache } from '../../functions/touchLruCache';
import { type CandidateEdge, buildOpGraph, collectCandidateEdges, getKeptOperations } from './opGraphBuilder';
import { detectorFor } from './opGraphBlockDetectors';
import {
    type OpGraphBuildOptions,
    type OpGraphBuiltGraph,
    type OpGraphSourceOperation,
    type OpGraphWorkerInboundMessage,
    OpGraphWorkerMessageType,
    type RepeatBlockInstance,
} from './opGraphTypes';
import { OpGraphGrouping } from './opGraphTypes';

// The op-range slider drives builds from Blueprint's continuous `onChange`, so
// requests arrive per pointer frame while Dagre takes 43ms on a typical report
// and seconds on a large one. Only the newest request of a burst is ever built;
// the rest are dropped unbuilt, which is safe because the view is only listening
// for its own newest request id anyway.
let pendingBuild: ({ requestId: number; sourceVersion: number } & OpGraphBuildOptions) | null = null;
let isDrainScheduled = false;

// Expansion makes the option space combinatorial rather than a single boolean, so
// the cache now earns its keep on the walk back out of a subgraph. Each entry
// holds a fully laid-out graph — every node with its `memberNames`, every edge, and
// its own copy of `graph.blocks`.
//
// Sized down from 16 because block folding added a third independently-toggleable
// key dimension: every detected instance folds and unrolls on its own, so exploring
// a handful of blocks mints a distinct key per toggle where this was previously
// rarely full. On an 8k-op report a full cache is retained for the whole session,
// freed only on `SET_GRAPH`.
const LAYOUT_CACHE_LIMIT = 8;
const layoutCache = new Map<string, OpGraphBuiltGraph>();

let sourceVersion = -1;
let operations: OpGraphSourceOperation[] = [];

// Keyed on the source version for the same reason the layout cache is: the
// `SET_GRAPH` clear is what frees the previous report, but without the version a
// clear that is ever moved or missed would fold report B using report A's block
// instances, whose member op ids exist in B but mean unrelated operations.
const detectionByOptions = new Map<string, RepeatBlockInstance[]>();

// One candidate-edge pass per source. It is an ops x outputs x consumers walk, and
// detection and the build both need it.
let candidateCache: { version: number; candidates: CandidateEdge[] } | null = null;

const candidatesOf = (): CandidateEdge[] => {
    if (candidateCache?.version !== sourceVersion) {
        candidateCache = { version: sourceVersion, candidates: collectCandidateEdges(operations) };
    }
    return candidateCache.candidates;
};

// Two options are derived rather than chosen, so they are not part of the key:
// detection is invariant under fold and device-op expansion (it is keyed separately on
// the two options it does depend on), and the candidate edges are a function of the
// operations, which the source version already identifies.
type CachedOption = Exclude<keyof OpGraphBuildOptions, 'detectedBlocks' | 'candidates'>;

// One part per option, as a record over the option keys rather than a template
// string: adding an option to `OpGraphBuildOptions` now fails to compile until it
// is keyed, where a hand-written key silently ignored it and served a layout built
// for the other value. That is the same omission `grouping` cost. #1976
const CACHE_KEY_PART: Readonly<Record<CachedOption, (options: OpGraphBuildOptions) => string>> = {
    hideDeallocate: (options) => String(options.hideDeallocate),
    // Sorted, so the key describes the set of expanded operations rather than the
    // order they were opened in.
    deviceSubgraphs: (options) =>
        options.deviceSubgraphs
            .map((subgraph) => subgraph.operationId)
            .sort((left, right) => left - right)
            .join(','),
    // `undefined` (nothing folded yet) and `[]` (fold every instance) build
    // different graphs, so they must not share a cache entry. #1977
    expandedBlockIds: (options) =>
        options.expandedBlockIds === undefined ? 'none' : [...options.expandedBlockIds].sort().join(','),
    grouping: (options) => options.grouping ?? OpGraphGrouping.REPEATS,
    collapseWeightLoads: (options) => String(options.collapseWeightLoads ?? false),
};

// Sorted by name so the key is stable whatever order the record is written in.
const CACHED_OPTIONS = (Object.keys(CACHE_KEY_PART) as CachedOption[]).sort();

// Keyed on the source version as well as the options. The `SET_GRAPH` clear is
// what frees the previous report's graphs, but keying on the version too means a
// stale entry can never be served if that clear is ever moved or missed.
const cacheKeyOf = (version: number, options: OpGraphBuildOptions): string =>
    [String(version), ...CACHED_OPTIONS.map((option) => CACHE_KEY_PART[option](options))].join(':');

const detectedBlocksOf = (hideDeallocate: boolean, grouping: OpGraphGrouping): RepeatBlockInstance[] => {
    // Grouping is part of the key: the two detectors answer the same question
    // differently, so one cache entry per deallocate setting would serve repeat
    // blocks to a layer-grouped build. #1976
    const key = `${sourceVersion}:${hideDeallocate}:${grouping}`;
    const cached = detectionByOptions.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const kept = getKeptOperations(operations, hideDeallocate, candidatesOf());
    const blocks = detectorFor(grouping)(kept);
    detectionByOptions.set(key, blocks);
    return blocks;
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

    // Spread for the same reason the message handler spreads: an option named here
    // is an option that can be forgotten here. #1976
    const { requestId: _requestId, sourceVersion: _sourceVersion, ...options } = request;
    const grouping = options.grouping ?? OpGraphGrouping.REPEATS;
    const cacheKey = cacheKeyOf(request.sourceVersion, options);
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
            ...options,
            grouping,
            detectedBlocks: detectedBlocksOf(options.hideDeallocate, grouping),
            // Already walked once for this source, and the build would otherwise walk
            // every edge again on each uncached layout — including every frame of a
            // drag on the op-range slider.
            candidates: candidatesOf(),
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
        detectionByOptions.clear();
        candidateCache = null;
        // A build queued against the previous source is moot; the view reissues
        // one for the new source as part of the same change.
        pendingBuild = null;
        return;
    }

    // Spread rather than re-listed field by field. The hand-written version silently
    // dropped `grouping` when it was added: every option is optional on
    // `OpGraphBuildOptions`, so an omitted one type-checks, and the build then ran the
    // default detector while the toolbar reported the mode the user had picked. Taking
    // everything except the discriminant cannot lose the next option either. #1976
    const { type: _discriminant, ...options } = message;
    pendingBuild = options;

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
