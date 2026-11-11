// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useRecordFilterUsed from '../src/hooks/useRecordFilterUsed';
import { EventLogEvent, FilterSurface } from '../src/definitions/EventLogEvent';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

const filterUsed = (surface: FilterSurface) => ({
    event: EventLogEvent.FILTER_USED,
    details: { filter_surface: surface },
});

beforeEach(() => {
    recordEvent.mockClear();
});

describe('useRecordFilterUsed', () => {
    it('records the first query of a mount and nothing after it', () => {
        const { result } = renderHook(() => useRecordFilterUsed(FilterSurface.OPERATIONS));

        result.current(false);
        result.current(true);
        result.current(false);
        result.current(true);

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(filterUsed(FilterSurface.OPERATIONS));
    });

    it('records again after a remount', () => {
        const first = renderHook(() => useRecordFilterUsed(FilterSurface.TENSORS));
        first.result.current(true);
        first.unmount();

        const second = renderHook(() => useRecordFilterUsed(FilterSurface.TENSORS));
        second.result.current(true);

        expect(recordEvent).toHaveBeenCalledTimes(2);
    });

    it('keeps one callback across renders, so handlers built on it stay stable', () => {
        const { result, rerender } = renderHook(() => useRecordFilterUsed(FilterSurface.MLIR_OP));
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
    });
});
