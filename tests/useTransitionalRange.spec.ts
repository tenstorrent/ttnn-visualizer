// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The hook lets a slider handle follow the pointer while the committed range re-renders its
 * consumers at transition priority. `commit` is a mock that never updates `committed`, so each case
 * sees what the hook itself shows, which is the part `RangeSlider`'s integration specs cannot
 * separate from the atom.
 */

import { NumberRange } from '@blueprintjs/core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useTransitionalRange from '../src/hooks/useTransitionalRange';

const COMMITTED: NumberRange = [1, 10];
const BOUNDS: NumberRange = [1, 10];

const renderTransitionalRange = (commit = vi.fn()) =>
    renderHook(({ committed, bounds }) => useTransitionalRange(committed, commit, bounds), {
        initialProps: { committed: COMMITTED, bounds: BOUNDS },
    });

describe('useTransitionalRange', () => {
    it('shows the dragged value before the commit lands, and commits every step', () => {
        const commit = vi.fn();
        const { result } = renderTransitionalRange(commit);

        act(() => result.current.onChange([3, 10]));
        act(() => result.current.onChange([4, 10]));

        expect(result.current.value).toEqual([4, 10]);
        expect(commit.mock.calls).toEqual([[[3, 10]], [[4, 10]]]);
    });

    it('goes back to the committed value on release', () => {
        const { result } = renderTransitionalRange();

        act(() => result.current.onChange([3, 10]));
        act(() => result.current.onRelease());

        expect(result.current.value).toBe(COMMITTED);
    });

    it('goes back to the committed value on cancel', () => {
        const { result } = renderTransitionalRange();

        act(() => result.current.onChange([3, 10]));
        act(() => result.current.cancel());

        expect(result.current.value).toBe(COMMITTED);
    });

    it('ignores a dragged value from another track', () => {
        const { result, rerender } = renderTransitionalRange();

        act(() => result.current.onChange([3, 10]));
        rerender({ committed: COMMITTED, bounds: [1, 20] });

        expect(result.current.value).toBe(COMMITTED);
    });

    it('keeps its handlers while commit and bounds are stable', () => {
        const { result, rerender } = renderTransitionalRange();
        const { onChange, onRelease, cancel } = result.current;

        act(() => result.current.onChange([3, 10]));
        rerender({ committed: [3, 10], bounds: BOUNDS });

        expect(result.current.onChange).toBe(onChange);
        expect(result.current.onRelease).toBe(onRelease);
        expect(result.current.cancel).toBe(cancel);
    });
});
