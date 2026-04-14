/* eslint-disable no-restricted-globals */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-continue */
import { buildVisibleGraph } from './mlirGraphBuilder';
import { buildGraphIndex } from './mlirGraphIndexBuilder';
import type { BuiltGraph, GraphIndex, WorkerInboundMessage } from './mlirGraphTypes';

const indexByGraphId = new Map<string, GraphIndex>();
const cacheByGraphId = new Map<string, Map<string, BuiltGraph>>();
const graphVersionByGraphId = new Map<string, number>();
const latestBuildByGraphId = new Map<
    string,
    { graphId: string; requestId: number; expandedNamespaces: string[]; cacheKey: string; graphVersion: number }
>();
const processingGraphIds = new Set<string>();

const getGraphVersion = (graphId: string): number => graphVersionByGraphId.get(graphId) ?? 0;

const postWorkerError = (requestId: number, error: unknown) => {
    postMessage({
        type: 'error',
        requestId,
        error: error instanceof Error ? error.message : String(error),
    });
};

async function processLatestBuild(graphId: string): Promise<void> {
    if (processingGraphIds.has(graphId)) {
        return;
    }
    processingGraphIds.add(graphId);
    try {
        while (true) {
            const request = latestBuildByGraphId.get(graphId);
            if (!request) {
                break;
            }
            latestBuildByGraphId.delete(graphId);

            const index = indexByGraphId.get(graphId);
            if (!index) {
                postMessage({
                    type: 'error',
                    requestId: request.requestId,
                    error: `Graph index not found for ${graphId}`,
                });
                continue;
            }
            if (request.graphVersion !== getGraphVersion(graphId)) {
                continue;
            }

            const cache = cacheByGraphId.get(graphId) ?? new Map<string, BuiltGraph>();
            cacheByGraphId.set(graphId, cache);

            const cached = cache.get(request.cacheKey);
            if (cached) {
                if (!latestBuildByGraphId.has(graphId)) {
                    postMessage({
                        type: 'built',
                        requestId: request.requestId,
                        graphId,
                        cacheKey: request.cacheKey,
                        graph: cached,
                    });
                }
                continue;
            }

            try {
                const built = await buildVisibleGraph(index, request.expandedNamespaces);
                cache.set(request.cacheKey, built);
                const newerRequestExists = latestBuildByGraphId.has(graphId);
                const graphVersionChanged = request.graphVersion !== getGraphVersion(graphId);
                if (!newerRequestExists && !graphVersionChanged) {
                    postMessage({
                        type: 'built',
                        requestId: request.requestId,
                        graphId,
                        cacheKey: request.cacheKey,
                        graph: built,
                    });
                }
            } catch (error) {
                if (!latestBuildByGraphId.has(graphId)) {
                    postWorkerError(request.requestId, error);
                }
            }
        }
    } finally {
        processingGraphIds.delete(graphId);
        if (latestBuildByGraphId.has(graphId)) {
            processLatestBuild(graphId).catch(() => {});
        }
    }
}

// Use addEventListener instead of self.onmessage because elkjs/lib/elk-worker.min.js
// overwrites self.onmessage with its own dispatcher when it detects a worker context.
// addEventListener is immune to that overwrite.
self.addEventListener('message', (event: MessageEvent<WorkerInboundMessage>) => {
    const message = event.data;

    if (message.type === 'set-graph') {
        try {
            const nextVersion = getGraphVersion(message.graphId) + 1;
            graphVersionByGraphId.set(message.graphId, nextVersion);
            const index = buildGraphIndex(message.graphId, message.nodes);
            indexByGraphId.set(message.graphId, index);
            cacheByGraphId.set(message.graphId, new Map());
            latestBuildByGraphId.delete(message.graphId);
            postMessage({
                type: 'indexed',
                graphId: message.graphId,
                interactionIndex: {
                    anchorByNamespace: index.anchorByNamespace,
                    anchorNamespaceByNodeId: index.anchorNamespaceByNodeId,
                    outerNamespaceByNodeId: index.outerNamespaceByNodeId,
                },
            });
        } catch (error) {
            postWorkerError(0, error);
        }
        return;
    }

    latestBuildByGraphId.set(message.graphId, {
        graphId: message.graphId,
        requestId: message.requestId,
        expandedNamespaces: message.expandedNamespaces,
        cacheKey: message.cacheKey,
        graphVersion: getGraphVersion(message.graphId),
    });
    processLatestBuild(message.graphId).catch(() => {});
});
