// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    type OpGraphBuildOptions,
    type OpGraphBuiltGraph,
    type OpGraphSourceOperation,
    OpGraphWorkerMessageType,
    type OpGraphWorkerOutboundMessage,
} from './opGraphTypes';

// A typical 300-op report lands well inside this, so the spinner never appears
// for the common toggle; only the rare large graph, where Dagre runs into
// seconds, waits long enough to earn one.
const BUILD_SPINNER_DELAY_MS = 200;

// Dagre measures 43ms on a typical 300-op report and seconds on the rare large
// one, hence a worker from v1 rather than a deferred optimisation. #1809
export function useOpGraphLayoutWorker(
    operations: OpGraphSourceOperation[],
    onBuilt: (graph: OpGraphBuiltGraph) => void,
): { runBuild: (options: OpGraphBuildOptions) => void; isBuilding: boolean } {
    const workerRef = useRef<Worker | null>(null);
    const nextRequestIdRef = useRef(0);
    const activeRequestIdRef = useRef(0);
    // 0 until the first `set-graph` post; builds before that have no source and
    // would be dropped by the worker, stranding the spinner.
    const sourceVersionRef = useRef(0);
    const spinnerTimeoutRef = useRef<number | null>(null);
    const [isBuilding, setIsBuilding] = useState(false);

    // The fallback runs outside the render that requested the build, so it needs
    // the current source and options rather than the ones it closed over.
    const operationsRef = useRef(operations);
    const optionsRef = useRef<OpGraphBuildOptions | null>(null);
    const onBuiltRef = useRef(onBuilt);
    useEffect(() => {
        onBuiltRef.current = onBuilt;
    }, [onBuilt]);

    const endBuild = useCallback(() => {
        if (spinnerTimeoutRef.current !== null) {
            window.clearTimeout(spinnerTimeoutRef.current);
            spinnerTimeoutRef.current = null;
        }
        setIsBuilding(false);
    }, []);

    // Dagre only reaches the main bundle if the worker actually fails, so the
    // recovery path costs nothing in the normal case.
    const buildOnMainThread = useCallback(
        async (requestId: number) => {
            const options = optionsRef.current;
            if (options === null) {
                endBuild();
                return;
            }
            try {
                const { buildOpGraph } = await import('./opGraphBuilder');
                // A newer request landed while the module loaded; its own reply
                // (or its own fallback) owns the outcome now.
                if (requestId !== activeRequestIdRef.current) {
                    return;
                }
                const graph = buildOpGraph(operationsRef.current, options);
                if (requestId !== activeRequestIdRef.current) {
                    return;
                }
                onBuiltRef.current(graph);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error('operation graph layout: main-thread fallback failed', error);
            } finally {
                endBuild();
            }
        },
        [endBuild],
    );

    useEffect(() => {
        const worker = new Worker(new URL('./opGraphLayoutWorker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        // A crash emits no terminal reply, so the layout has to be redone here or
        // the view keeps whatever graph it had with no way back.
        worker.onerror = () => {
            void buildOnMainThread(activeRequestIdRef.current);
        };
        return () => {
            worker.terminate();
            workerRef.current = null;
        };
    }, [buildOnMainThread]);

    useEffect(
        () => () => {
            if (spinnerTimeoutRef.current !== null) {
                window.clearTimeout(spinnerTimeoutRef.current);
            }
        },
        [],
    );

    useEffect(() => {
        const worker = workerRef.current;
        if (!worker) {
            return;
        }
        worker.onmessage = (event: MessageEvent<OpGraphWorkerOutboundMessage>) => {
            const message = event.data;
            if (message.requestId !== activeRequestIdRef.current) {
                return;
            }
            if (message.type === OpGraphWorkerMessageType.ERROR) {
                // eslint-disable-next-line no-console
                console.error('operation graph layout worker:', message.error);
                void buildOnMainThread(message.requestId);
                return;
            }
            endBuild();
            if (message.sourceVersion !== sourceVersionRef.current) {
                return;
            }
            onBuiltRef.current(message.graph);
        };
    }, [buildOnMainThread, endBuild]);

    useEffect(() => {
        operationsRef.current = operations;
        const worker = workerRef.current;
        if (!worker) {
            return;
        }
        const sourceVersion = sourceVersionRef.current + 1;
        sourceVersionRef.current = sourceVersion;
        worker.postMessage({
            type: OpGraphWorkerMessageType.SET_GRAPH,
            sourceVersion,
            operations,
        });
    }, [operations]);

    const runBuild = useCallback(
        (options: OpGraphBuildOptions) => {
            const worker = workerRef.current;
            if (!worker || sourceVersionRef.current === 0) {
                return;
            }
            const requestId = nextRequestIdRef.current + 1;
            nextRequestIdRef.current = requestId;
            activeRequestIdRef.current = requestId;
            optionsRef.current = options;
            // The clock runs from the first build of a burst rather than
            // restarting per request: someone toggling repeatedly has still been
            // waiting, and a restarting timer would deny them a spinner for as
            // long as they keep toggling. Clearing the ref as the timer fires
            // keeps "non-null" meaning "a timer is still pending".
            if (spinnerTimeoutRef.current === null) {
                spinnerTimeoutRef.current = window.setTimeout(() => {
                    spinnerTimeoutRef.current = null;
                    setIsBuilding(true);
                }, BUILD_SPINNER_DELAY_MS);
            }
            try {
                worker.postMessage({
                    type: OpGraphWorkerMessageType.BUILD,
                    sourceVersion: sourceVersionRef.current,
                    requestId,
                    ...options,
                });
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error('operation graph layout worker: build dispatch failed', error);
                void buildOnMainThread(requestId);
            }
        },
        [buildOnMainThread],
    );

    return { runBuild, isBuilding };
}
