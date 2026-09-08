// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMlirLayoutWorker } from '../src/components/mlir/useMlirLayoutWorker';
import type {
    BuildMessage,
    BuiltGraph,
    SourceNode,
    WorkerInboundMessage,
    WorkerInteractionIndex,
    WorkerOutboundMessage,
} from '../src/components/mlir/mlirGraphTypes';

const GRAPH_ID = 'g1';
const SOURCE_NODES: SourceNode[] = [];
const EMPTY_GRAPH = { nodes: [], edges: [] } satisfies BuiltGraph;
const EMPTY_INTERACTION_INDEX = {} as WorkerInteractionIndex;

const workers: FakeWorker[] = [];

// Stands in for the layout Web Worker (jsdom has no Worker); lets the test drive
// the request/response protocol the hook owns.
class FakeWorker {
    onmessage: ((event: MessageEvent<WorkerOutboundMessage>) => void) | null = null;

    onerror: ((event: unknown) => void) | null = null;

    readonly posted: WorkerInboundMessage[] = [];

    terminated = false;

    constructor() {
        workers.push(this);
    }

    postMessage(message: WorkerInboundMessage): void {
        this.posted.push(message);
    }

    terminate(): void {
        this.terminated = true;
    }

    emit(data: WorkerOutboundMessage): void {
        act(() => {
            this.onmessage?.({ data } as unknown as MessageEvent<WorkerOutboundMessage>);
        });
    }

    crash(): void {
        act(() => {
            this.onerror?.(new Event('error'));
        });
    }
}

const worker = (): FakeWorker => {
    const instance = workers.at(-1);
    if (!instance) {
        throw new Error('worker not constructed');
    }
    return instance;
};

const lastBuildRequestId = (): number => {
    const build = [...worker().posted].reverse().find((m): m is BuildMessage => m.type === 'build');
    if (!build) {
        throw new Error('no build message posted');
    }
    return build.requestId;
};

describe('useMlirLayoutWorker', () => {
    beforeEach(() => {
        workers.length = 0;
        vi.stubGlobal('Worker', FakeWorker);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const setup = () => {
        const onBuilt = vi.fn();
        const view = renderHook(() => useMlirLayoutWorker(GRAPH_ID, SOURCE_NODES, onBuilt));
        // Enable builds: the hook only dispatches once the worker confirms `indexed`.
        worker().emit({ type: 'indexed', graphId: GRAPH_ID, interactionIndex: EMPTY_INTERACTION_INDEX });
        return { ...view, onBuilt };
    };

    it('starts idle and posts set-graph on mount', () => {
        const { result } = setup();
        expect(result.current.isBuilding).toBe(false);
        expect(worker().posted).toContainEqual(expect.objectContaining({ type: 'set-graph', graphId: GRAPH_ID }));
    });

    it('flips isBuilding true on dispatch and false when the matching built reply lands', () => {
        const { result, onBuilt } = setup();

        act(() => result.current.runBuild(new Set()));
        expect(result.current.isBuilding).toBe(true);

        worker().emit({
            type: 'built',
            requestId: lastBuildRequestId(),
            graphId: GRAPH_ID,
            cacheKey: `${GRAPH_ID}:`,
            graph: EMPTY_GRAPH,
        });

        expect(result.current.isBuilding).toBe(false);
        expect(onBuilt).toHaveBeenCalledWith(EMPTY_GRAPH);
    });

    it('clears isBuilding when the worker replies with an error', () => {
        const { result } = setup();
        act(() => result.current.runBuild(new Set()));

        worker().emit({ type: 'error', requestId: lastBuildRequestId(), error: 'boom' });

        expect(result.current.isBuilding).toBe(false);
    });

    it('clears isBuilding when the worker crashes (no terminal reply)', () => {
        const { result, onBuilt } = setup();
        act(() => result.current.runBuild(new Set()));
        expect(result.current.isBuilding).toBe(true);

        worker().crash();

        expect(result.current.isBuilding).toBe(false);
        expect(onBuilt).not.toHaveBeenCalled();
    });

    it('swallows a synchronous postMessage failure (dead worker) without crashing', () => {
        const { result } = setup();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        worker().postMessage = () => {
            throw new Error('worker terminated');
        };

        expect(() => act(() => result.current.runBuild(new Set()))).not.toThrow();
        expect(result.current.isBuilding).toBe(false);

        consoleError.mockRestore();
    });

    it('ignores a stale built reply from a superseded request', () => {
        const { result, onBuilt } = setup();
        act(() => result.current.runBuild(new Set()));
        const staleRequestId = lastBuildRequestId() - 1;

        worker().emit({
            type: 'built',
            requestId: staleRequestId,
            graphId: GRAPH_ID,
            cacheKey: `${GRAPH_ID}:`,
            graph: EMPTY_GRAPH,
        });

        expect(result.current.isBuilding).toBe(true);
        expect(onBuilt).not.toHaveBeenCalled();
    });
});
