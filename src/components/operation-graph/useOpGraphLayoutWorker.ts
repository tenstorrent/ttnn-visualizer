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
    const [isBuilding, setIsBuilding] = useState(false);

    useEffect(() => {
        const worker = new Worker(new URL('./opGraphLayoutWorker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        // A crash emits no terminal reply, stranding the spinner with no way back.
        worker.onerror = () => {
            setIsBuilding(false);
        };
        return () => {
            worker.terminate();
            workerRef.current = null;
        };
    }, []);

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
            setIsBuilding(false);
            if (message.type === OpGraphWorkerMessageType.ERROR) {
                // eslint-disable-next-line no-console
                console.error('operation graph layout worker:', message.error);
                return;
            }
            if (message.sourceVersion !== sourceVersionRef.current) {
                return;
            }
            onBuilt(message.graph);
        };
    }, [onBuilt]);

    useEffect(() => {
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

    const runBuild = useCallback((options: OpGraphBuildOptions) => {
        const worker = workerRef.current;
        if (!worker || sourceVersionRef.current === 0) {
            return;
        }
        const requestId = nextRequestIdRef.current + 1;
        nextRequestIdRef.current = requestId;
        activeRequestIdRef.current = requestId;
        setIsBuilding(true);
        try {
            worker.postMessage({
                type: OpGraphWorkerMessageType.BUILD,
                sourceVersion: sourceVersionRef.current,
                requestId,
                ...options,
            });
        } catch (error) {
            setIsBuilding(false);
            // eslint-disable-next-line no-console
            console.error('operation graph layout worker: build dispatch failed', error);
        }
    }, []);

    return { runBuild, isBuilding };
}
