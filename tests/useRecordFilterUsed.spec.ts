// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterSurface } from '../src/definitions/EventLogEvent';
import useRecordFilterUsed from '../src/hooks/useRecordFilterUsed';

const { recordFilterUsed } = vi.hoisted(() => ({ recordFilterUsed: vi.fn() }));

vi.mock('../src/functions/surfaceEvents', () => ({ recordFilterUsed }));

beforeEach(() => {
    recordFilterUsed.mockClear();
});

// The search fields offer no way to clear an empty query, so the guard against recording a
// change that leaves no query is pinned here rather than through a component.
describe('useRecordFilterUsed', () => {
    it('records nothing for a change that leaves no query', () => {
        const { result } = renderHook(() => useRecordFilterUsed(FilterSurface.PERF_OP_CODE));

        result.current(false);

        expect(recordFilterUsed).not.toHaveBeenCalled();
    });

    it('records the first change that leaves a query, after one that left none', () => {
        const { result } = renderHook(() => useRecordFilterUsed(FilterSurface.PERF_OP_CODE));

        result.current(false);
        result.current(true);

        expect(recordFilterUsed).toHaveBeenCalledExactlyOnceWith(FilterSurface.PERF_OP_CODE);
    });

    it('records once per mount however many changes leave a query', () => {
        const { result, rerender } = renderHook(() => useRecordFilterUsed(FilterSurface.PERF_OP_CODE));

        result.current(true);
        rerender();
        result.current(false);
        result.current(true);

        expect(recordFilterUsed).toHaveBeenCalledOnce();
    });

    it('records again on a later mount', () => {
        const first = renderHook(() => useRecordFilterUsed(FilterSurface.PERF_OP_CODE));
        first.result.current(true);
        first.unmount();

        renderHook(() => useRecordFilterUsed(FilterSurface.PERF_OP_CODE)).result.current(true);

        expect(recordFilterUsed).toHaveBeenCalledTimes(2);
    });

    it('keeps one callback across renders, so handlers built on it stay stable', () => {
        const { result, rerender } = renderHook(() => useRecordFilterUsed(FilterSurface.PERF_OP_CODE));
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
    });
});
