// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useBufferFocus from '../src/hooks/useBufferFocus';
import { DrilldownTarget, EventLogEvent } from '../src/definitions/EventLogEvent';
import { TestProviders } from './helpers/TestProviders';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));
vi.mock('../src/functions/createToastNotification', async () => {
    const { toastNotificationModuleMock } = await import('./helpers/mockToastNotification');

    return toastNotificationModuleMock();
});

const wrapper = ({ children }: { children: ReactNode }) => <TestProviders>{children}</TestProviders>;

beforeEach(() => {
    recordEvent.mockClear();
});

describe('useBufferFocus drill-down event', () => {
    const CLICK = { recordDrilldown: true };

    it('records each buffer a click focuses, and nothing for clearing it', () => {
        const { result } = renderHook(() => useBufferFocus(), { wrapper });

        act(() => result.current.updateBufferFocus(1024, 3, undefined, CLICK));
        act(() => result.current.updateBufferFocus(2048, undefined, undefined, CLICK));
        act(() => result.current.resetBufferFocus());

        expect(recordEvent.mock.calls).toEqual([
            [{ event: EventLogEvent.DRILLDOWN_OPENED, details: { drilldown_target: DrilldownTarget.BUFFER_DETAILS } }],
            [{ event: EventLogEvent.DRILLDOWN_OPENED, details: { drilldown_target: DrilldownTarget.BUFFER_DETAILS } }],
        ]);
    });

    it('records nothing for a click on the buffer already focused', () => {
        const { result } = renderHook(() => useBufferFocus(), { wrapper });

        act(() => result.current.updateBufferFocus(1024, 3, undefined, CLICK));
        act(() => result.current.updateBufferFocus(1024, 3, undefined, CLICK));

        expect(recordEvent).toHaveBeenCalledOnce();
    });

    it('records a click on a buffer at the same address but for another tensor', () => {
        const { result } = renderHook(() => useBufferFocus(), { wrapper });

        act(() => result.current.updateBufferFocus(1024, 3, undefined, CLICK));
        act(() => result.current.updateBufferFocus(1024, 4, undefined, CLICK));

        expect(recordEvent).toHaveBeenCalledTimes(2);
    });

    it('records nothing for a focus set by code, such as one that follows navigation', () => {
        const { result } = renderHook(() => useBufferFocus(), { wrapper });

        act(() => result.current.updateBufferFocus(1024, 3));

        expect(recordEvent).not.toHaveBeenCalled();
    });
});
