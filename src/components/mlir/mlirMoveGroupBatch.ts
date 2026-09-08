// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Coalesces group-drag mousemove deltas into a single per-frame write. A
// header drag fires many `mousemove` events per animation frame; without
// batching each one would trigger a `setNodes(prev.map(...))` pass over the
// whole node array. The batcher accumulates deltas per group id and flushes
// them once per requested frame.
//
// Extracted from `MLIRViewReactFlow.tsx` so the accumulate / flush / cancel
// discipline — in particular the cancel-on-rebuild path that prevents a
// pending delta from being applied on top of a fresh worker placement — is
// unit-testable without mounting React Flow.

export interface MoveGroupBatcherDeps {
    // Applies an accumulated delta to a single group's position.
    applyDelta: (groupId: string, dx: number, dy: number) => void;
    // Schedules `flush` on the next frame; returns a handle for cancellation.
    requestFrame: (callback: () => void) => number;
    // Cancels a previously scheduled frame.
    cancelFrame: (handle: number) => void;
}

export interface MoveGroupBatcher {
    // Adds a delta for `groupId`, scheduling a flush if one isn't pending.
    accumulate: (groupId: string, dx: number, dy: number) => void;
    // Applies every pending delta and clears the queue. Normally invoked by
    // the scheduled frame; exposed for tests / synchronous flushing.
    flush: () => void;
    // Drops every pending delta and cancels the scheduled frame. Used on
    // worker rebuild (the delta would land on top of the canonical position)
    // and on unmount (to release a dangling frame).
    cancel: () => void;
}

export function createMoveGroupBatcher(deps: MoveGroupBatcherDeps): MoveGroupBatcher {
    const pending = new Map<string, { dx: number; dy: number }>();
    let frameHandle: number | null = null;

    const flush = (): void => {
        frameHandle = null;
        if (pending.size === 0) {
            return;
        }
        for (const [groupId, delta] of pending) {
            deps.applyDelta(groupId, delta.dx, delta.dy);
        }
        pending.clear();
    };

    return {
        accumulate(groupId: string, dx: number, dy: number): void {
            const existing = pending.get(groupId);
            if (existing) {
                existing.dx += dx;
                existing.dy += dy;
            } else {
                pending.set(groupId, { dx, dy });
            }
            if (frameHandle === null) {
                frameHandle = deps.requestFrame(flush);
            }
        },
        flush,
        cancel(): void {
            if (frameHandle !== null) {
                deps.cancelFrame(frameHandle);
                frameHandle = null;
            }
            pending.clear();
        },
    };
}
