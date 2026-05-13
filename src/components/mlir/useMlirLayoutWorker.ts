// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuiltGraph, SourceNode, WorkerInteractionIndex, WorkerOutboundMessage } from './mlirGraphTypes';

/**
 * Owns the MLIR layout Web Worker's lifecycle and request/response protocol.
 *
 * Responsibilities (extracted from `MlGraphInner` so the view component can
 * stay focused on React Flow / selection / viewport concerns):
 *
 * 1. Spawn the worker on mount, terminate on unmount.
 * 2. Post a `set-graph` message exactly once per `graphId` change — the
 *    worker uses that to (re)build its `GraphIndex` from scratch.
 * 3. Track the latest in-flight `build` request id so stale `built` replies
 *    from a superseded request are ignored.
 * 4. Surface `interactionIndex` (anchors, outer-namespace map) as soon as the
 *    worker emits its `indexed` message — the view layer needs this to drive
 *    expand/collapse behaviour.
 * 5. Hand back a stable `runBuild(expanded)` dispatcher that the consumer
 *    triggers from a `useEffect([expandedNamespaces, runBuild])`.
 *
 * `onBuilt` is invoked on the React event loop when a fresh `built` message
 * arrives for the current `graphId`. It deliberately stays in the consumer so
 * `applyBuiltGraph` (which touches viewport refs, RF setters, and the
 * `selectedNodeId` ref) doesn't have to leak out of the view component.
 */
export function useMlirLayoutWorker(
    graphId: string,
    sourceNodes: SourceNode[],
    onBuilt: (graph: BuiltGraph) => void,
): {
    interactionIndex: WorkerInteractionIndex | null;
    runBuild: (expanded: Set<string>) => void;
} {
    const workerRef = useRef<Worker | null>(null);
    const nextRequestIdRef = useRef(0);
    const activeRequestIdRef = useRef(0);
    const postedGraphIdRef = useRef<string | null>(null);
    const [indexReadyGraphId, setIndexReadyGraphId] = useState<string | null>(null);
    const [interactionIndex, setInteractionIndex] = useState<WorkerInteractionIndex | null>(null);

    useEffect(() => {
        const worker = new Worker(new URL('./mlirLayoutWorker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        return () => {
            worker.terminate();
            workerRef.current = null;
            postedGraphIdRef.current = null;
        };
    }, []);

    useEffect(() => {
        const worker = workerRef.current;
        if (!worker) {
            return;
        }
        worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
            const message = event.data;
            if (message.type === 'indexed') {
                if (message.graphId === graphId) {
                    setInteractionIndex(message.interactionIndex);
                    setIndexReadyGraphId(message.graphId);
                }
                return;
            }
            if (message.type === 'error') {
                if (message.requestId !== 0 && message.requestId !== activeRequestIdRef.current) {
                    return;
                }
                // eslint-disable-next-line no-console
                console.error('mlir layout worker:', message.error);
                return;
            }
            if (message.requestId !== activeRequestIdRef.current) {
                return;
            }
            if (message.graphId !== graphId) {
                return;
            }
            onBuilt(message.graph);
        };
    }, [graphId, onBuilt]);

    useEffect(() => {
        const worker = workerRef.current;
        if (!worker) {
            return;
        }
        if (postedGraphIdRef.current === graphId) {
            return;
        }
        postedGraphIdRef.current = graphId;
        // No need to reset `indexReadyGraphId` here — every consumer guards on
        // `indexReadyGraphId !== graphId`, so a stale value from the previous
        // graph already blocks builds until the worker confirms `indexed` for
        // the new graphId. Setting state directly inside an effect also trips
        // react-hooks/set-state-in-effect.
        worker.postMessage({
            type: 'set-graph',
            graphId,
            nodes: sourceNodes,
        });
    }, [graphId, sourceNodes]);

    const runBuild = useCallback(
        (expanded: Set<string>) => {
            const worker = workerRef.current;
            if (!worker || indexReadyGraphId !== graphId) {
                return;
            }
            const requestId = nextRequestIdRef.current + 1;
            nextRequestIdRef.current = requestId;
            activeRequestIdRef.current = requestId;
            const expandedSorted = Array.from(expanded).sort((a, b) => a.localeCompare(b));
            worker.postMessage({
                type: 'build' as const,
                requestId,
                graphId,
                expandedNamespaces: expandedSorted,
                cacheKey: `${graphId}:${expandedSorted.join('|')}`,
            });
        },
        [graphId, indexReadyGraphId],
    );

    return { interactionIndex, runBuild };
}
