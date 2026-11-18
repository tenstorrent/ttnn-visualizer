// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Pins that a "Buffer details" navigation records nothing when it lands: the click that
 * started it records the drill-down, and the landing effect runs once per buffer list that
 * mounts, which is twice when the Buffers page switches tab.
 */

import { cleanup, renderHook } from '@testing-library/react';
import { Virtualizer } from '@tanstack/react-virtual';
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useBufferNavigation from '../src/hooks/useBufferNavigation';
import { BufferType } from '../src/model/BufferType';
import { TestProviders } from './helpers/TestProviders';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));
vi.mock('../src/functions/createToastNotification', async () => {
    const { toastNotificationModuleMock } = await import('./helpers/mockToastNotification');

    return toastNotificationModuleMock();
});

const wrapper = ({ children }: { children: ReactNode }) => (
    <TestProviders
        initialEntries={[
            { pathname: '/buffers', state: { tensorId: 7, tensorAddress: 1024, bufferType: BufferType.DRAM } },
        ]}
    >
        {children}
    </TestProviders>
);

const renderNavigation = () =>
    renderHook(
        () =>
            useBufferNavigation({
                buffersByOperation: [],
                tensorListByOperation: new Map(),
                virtualizer: {} as Virtualizer<HTMLDivElement, HTMLDivElement>,
            }),
        { wrapper },
    );

beforeEach(() => {
    recordEvent.mockClear();
});

// RTL auto-cleanup is off in this project.
afterEach(cleanup);

describe('useBufferNavigation drill-down event', () => {
    it('records nothing when the navigation lands, on either tab', () => {
        renderNavigation().unmount();
        renderNavigation();

        expect(recordEvent).not.toHaveBeenCalled();
    });
});
