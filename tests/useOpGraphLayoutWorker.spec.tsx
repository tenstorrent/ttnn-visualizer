// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOpGraphLayoutWorker } from '../src/components/operation-graph/useOpGraphLayoutWorker';
import {
    type OpGraphBuildOptions,
    type OpGraphSourceOperation,
    type OpGraphWorkerInboundMessage,
    OpGraphWorkerMessageType,
    type OpGraphWorkerOutboundMessage,
} from '../src/components/operation-graph/opGraphTypes';

const OPERATIONS: OpGraphSourceOperation[] = [
    { id: 1, name: 'matmul', fileIdentifier: 'model.py:1', outputs: [{ edgeLabel: '[1, 32]', consumers: [2] }] },
    { id: 2, name: 'add', fileIdentifier: 'model.py:2', outputs: [] },
];

const BUILD_OPTIONS: OpGraphBuildOptions = { hideDeallocate: true };

// Matches `BUILD_SPINNER_DELAY_MS` in the hook. Duplicated rather than exported,
// so a change to the delay has to be a deliberate change to this expectation.
const SPINNER_DELAY_MS = 200;

const workers: FakeWorker[] = [];

// jsdom has no Worker. This stands in for it and lets a test drive the
// request/reply protocol, including the failures the fallback exists for.
class FakeWorker {
    onmessage: ((event: MessageEvent<OpGraphWorkerOutboundMessage>) => void) | null = null;

    onerror: ((event: unknown) => void) | null = null;

    readonly posted: OpGraphWorkerInboundMessage[] = [];

    terminated = false;

    constructor() {
        workers.push(this);
    }

    postMessage(message: OpGraphWorkerInboundMessage): void {
        this.posted.push(message);
    }

    terminate(): void {
        this.terminated = true;
    }

    crash(): void {
        act(() => {
            this.onerror?.(new Event('error'));
        });
    }

    emit(data: OpGraphWorkerOutboundMessage): void {
        act(() => {
            this.onmessage?.({ data } as unknown as MessageEvent<OpGraphWorkerOutboundMessage>);
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
    const build = [...worker().posted].reverse().find((message) => message.type === OpGraphWorkerMessageType.BUILD);
    if (!build || build.type !== OpGraphWorkerMessageType.BUILD) {
        throw new Error('no build message posted');
    }
    return build.requestId;
};

const setup = () => {
    const onBuilt = vi.fn();
    const view = renderHook(() => useOpGraphLayoutWorker(OPERATIONS, onBuilt));
    return { ...view, onBuilt };
};

beforeEach(() => {
    workers.length = 0;
    vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('useOpGraphLayoutWorker', () => {
    it('lays the graph out on the main thread when the worker crashes', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result, onBuilt } = setup();
        act(() => result.current.runBuild(BUILD_OPTIONS));

        // A crash produces no terminal reply, so without the fallback the view
        // would sit on whatever graph it already had with no way to recover.
        worker().crash();

        await waitFor(() => expect(onBuilt).toHaveBeenCalledTimes(1));
        const graph = onBuilt.mock.calls[0][0];
        expect(graph.nodes).toHaveLength(2);
        expect(graph.edges).toHaveLength(1);
        expect(result.current.isBuilding).toBe(false);
        consoleError.mockRestore();
    });

    it('falls back when the build can not even be dispatched', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result, onBuilt } = setup();
        // A worker killed between mount and dispatch throws synchronously here.
        // Only the build is refused; the graph it holds was posted on mount.
        worker().postMessage = (message: OpGraphWorkerInboundMessage) => {
            if (message.type === OpGraphWorkerMessageType.BUILD) {
                throw new Error('worker terminated');
            }
        };

        expect(() => act(() => result.current.runBuild(BUILD_OPTIONS))).not.toThrow();

        await waitFor(() => expect(onBuilt).toHaveBeenCalledTimes(1));
        expect(result.current.isBuilding).toBe(false);
        consoleError.mockRestore();
    });

    it('holds the spinner back so a fast build never flashes one', () => {
        vi.useFakeTimers();
        const { result, onBuilt } = setup();

        act(() => result.current.runBuild(BUILD_OPTIONS));
        expect(result.current.isBuilding).toBe(false);

        worker().emit({
            type: OpGraphWorkerMessageType.BUILT,
            requestId: lastBuildRequestId(),
            sourceVersion: 1,
            graph: { nodes: [], edges: [] },
        });
        act(() => {
            vi.advanceTimersByTime(SPINNER_DELAY_MS * 2);
        });

        expect(result.current.isBuilding).toBe(false);
        expect(onBuilt).toHaveBeenCalledTimes(1);
    });

    it('shows the spinner once a build outruns the delay', () => {
        vi.useFakeTimers();
        const { result } = setup();

        act(() => result.current.runBuild(BUILD_OPTIONS));
        act(() => {
            vi.advanceTimersByTime(SPINNER_DELAY_MS);
        });

        expect(result.current.isBuilding).toBe(true);
    });

    it('measures the spinner delay from the first build of a burst', () => {
        vi.useFakeTimers();
        const { result } = setup();

        // Restarting the delay per request would let a run of quick toggles
        // suppress the spinner indefinitely, however long the user waits.
        act(() => result.current.runBuild(BUILD_OPTIONS));
        act(() => {
            vi.advanceTimersByTime(SPINNER_DELAY_MS / 2);
        });
        act(() => result.current.runBuild(BUILD_OPTIONS));
        act(() => {
            vi.advanceTimersByTime(SPINNER_DELAY_MS / 2);
        });

        expect(result.current.isBuilding).toBe(true);
    });

    it('ignores a built reply that belongs to a superseded request', () => {
        const { result, onBuilt } = setup();
        act(() => result.current.runBuild(BUILD_OPTIONS));

        worker().emit({
            type: OpGraphWorkerMessageType.BUILT,
            requestId: lastBuildRequestId() - 1,
            sourceVersion: 1,
            graph: { nodes: [], edges: [] },
        });

        expect(onBuilt).not.toHaveBeenCalled();
    });
});
