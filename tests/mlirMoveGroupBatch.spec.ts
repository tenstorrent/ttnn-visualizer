// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it, vi } from 'vitest';
import { createMoveGroupBatcher } from '../src/components/mlir/mlirMoveGroupBatch';

// A hand-driven frame scheduler: `accumulate` schedules a flush, and the test
// decides when (or whether) that frame runs by invoking `runFrame`.
function makeHarness() {
    const applyDelta = vi.fn<(groupId: string, dx: number, dy: number) => void>();
    const cancelFrame = vi.fn<(handle: number) => void>();
    let pendingCallback: (() => void) | null = null;
    let nextHandle = 0;

    const requestFrame = vi.fn((callback: () => void): number => {
        pendingCallback = callback;
        nextHandle += 1;
        return nextHandle;
    });

    const batcher = createMoveGroupBatcher({ applyDelta, requestFrame, cancelFrame });

    const runFrame = (): void => {
        const callback = pendingCallback;
        pendingCallback = null;
        callback?.();
    };

    return { batcher, applyDelta, requestFrame, cancelFrame, runFrame };
}

describe('createMoveGroupBatcher', () => {
    it('coalesces successive deltas for one group into a single per-frame write', () => {
        const { batcher, applyDelta, requestFrame, runFrame } = makeHarness();

        batcher.accumulate('g1', 3, 1);
        batcher.accumulate('g1', 2, -4);
        batcher.accumulate('g1', 5, 0);

        // Only one frame requested despite three mousemove-style deltas.
        expect(requestFrame).toHaveBeenCalledTimes(1);
        expect(applyDelta).not.toHaveBeenCalled();

        runFrame();

        expect(applyDelta).toHaveBeenCalledTimes(1);
        expect(applyDelta).toHaveBeenCalledWith('g1', 10, -3);
    });

    it('accumulates independently per group id', () => {
        const { batcher, applyDelta, runFrame } = makeHarness();

        batcher.accumulate('g1', 1, 1);
        batcher.accumulate('g2', 10, 20);
        batcher.accumulate('g1', 4, 5);

        runFrame();

        expect(applyDelta).toHaveBeenCalledTimes(2);
        expect(applyDelta).toHaveBeenCalledWith('g1', 5, 6);
        expect(applyDelta).toHaveBeenCalledWith('g2', 10, 20);
    });

    it('requests a fresh frame after a flush', () => {
        const { batcher, applyDelta, requestFrame, runFrame } = makeHarness();

        batcher.accumulate('g1', 1, 0);
        runFrame();
        expect(requestFrame).toHaveBeenCalledTimes(1);

        batcher.accumulate('g1', 2, 0);
        expect(requestFrame).toHaveBeenCalledTimes(2);
        runFrame();

        expect(applyDelta).toHaveBeenCalledTimes(2);
        expect(applyDelta).toHaveBeenLastCalledWith('g1', 2, 0);
    });

    it('cancel drops the pending delta and cancels the scheduled frame (rebuild path)', () => {
        const { batcher, applyDelta, cancelFrame, runFrame } = makeHarness();

        batcher.accumulate('g1', 7, 7);
        batcher.cancel();

        expect(cancelFrame).toHaveBeenCalledTimes(1);

        // Even if a stale frame were to fire, nothing is applied.
        runFrame();
        expect(applyDelta).not.toHaveBeenCalled();
    });

    it('cancel with nothing pending is a no-op', () => {
        const { batcher, applyDelta, cancelFrame } = makeHarness();

        batcher.cancel();

        expect(cancelFrame).not.toHaveBeenCalled();
        expect(applyDelta).not.toHaveBeenCalled();
    });

    it('resumes batching normally after a cancel', () => {
        const { batcher, applyDelta, runFrame } = makeHarness();

        batcher.accumulate('g1', 1, 1);
        batcher.cancel();

        batcher.accumulate('g1', 9, 9);
        runFrame();

        expect(applyDelta).toHaveBeenCalledTimes(1);
        expect(applyDelta).toHaveBeenCalledWith('g1', 9, 9);
    });
});
