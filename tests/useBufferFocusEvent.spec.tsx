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
    it('records each buffer focused, and nothing for clearing it', () => {
        const { result } = renderHook(() => useBufferFocus(), { wrapper });

        act(() => result.current.updateBufferFocus(1024, 3));
        act(() => result.current.updateBufferFocus(2048));
        act(() => result.current.resetBufferFocus());

        expect(recordEvent.mock.calls).toEqual([
            [{ event: EventLogEvent.DRILLDOWN_OPENED, details: { drilldown_target: DrilldownTarget.BUFFER_DETAILS } }],
            [{ event: EventLogEvent.DRILLDOWN_OPENED, details: { drilldown_target: DrilldownTarget.BUFFER_DETAILS } }],
        ]);
    });
});
