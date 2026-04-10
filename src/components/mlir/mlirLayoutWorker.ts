/* eslint-disable no-restricted-globals */
import { buildVisibleGraph } from './mlirGraphBuilder';
import { buildGraphIndex } from './mlirGraphIndexBuilder';
import type { BuiltGraph, GraphIndex, WorkerInboundMessage } from './mlirGraphTypes';

const indexByGraphId = new Map<string, GraphIndex>();
const cacheByGraphId = new Map<string, Map<string, BuiltGraph>>();

self.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
    const message = event.data;

    if (message.type === 'set-graph') {
        const index = buildGraphIndex(message.graphId, message.nodes);
        indexByGraphId.set(message.graphId, index);
        cacheByGraphId.set(message.graphId, new Map());
        postMessage({
            type: 'indexed',
            graphId: message.graphId,
            interactionIndex: {
                anchorByNamespace: index.anchorByNamespace,
                anchorNamespaceByNodeId: index.anchorNamespaceByNodeId,
                outerNamespaceByNodeId: index.outerNamespaceByNodeId,
            },
        });
        return;
    }

    const { graphId, requestId, expandedNamespaces, cacheKey } = message;
    try {
        const index = indexByGraphId.get(graphId);
        if (!index) {
            postMessage({
                type: 'error',
                requestId,
                error: `Graph index not found for ${graphId}`,
            });
            return;
        }

        const cache = cacheByGraphId.get(graphId) ?? new Map<string, BuiltGraph>();
        cacheByGraphId.set(graphId, cache);
        const cached = cache.get(cacheKey);
        if (cached) {
            postMessage({
                type: 'built',
                requestId,
                graphId,
                cacheKey,
                graph: cached,
            });
            return;
        }

        const built = await buildVisibleGraph(index, expandedNamespaces);
        cache.set(cacheKey, built);
        postMessage({
            type: 'built',
            requestId,
            graphId,
            cacheKey,
            graph: built,
        });
    } catch (error) {
        postMessage({
            type: 'error',
            requestId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
