// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Pins that a click on a buffer in a Buffer Summary row records `buffer_details`. Focus
 * records nothing unless its caller opts in, so dropping the opt-in here would silently
 * stop the event; the hook's own spec cannot notice that.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BufferSummaryRow from '../src/components/buffer-summary/BufferSummaryRow';
import { DrilldownTarget, EventLogEvent } from '../src/definitions/EventLogEvent';
import { BufferType } from '../src/model/BufferType';
import { TestProviders } from './helpers/TestProviders';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));
vi.mock('../src/functions/createToastNotification', async () => {
    const { toastNotificationModuleMock } = await import('./helpers/mockToastNotification');

    return toastNotificationModuleMock();
});

// The row maps a click to a buffer by its on-screen width, which jsdom reports as zero.
const CANVAS_WIDTH = 1200;
const MEMORY_START = 0;
const MEMORY_END = 4096;

const renderRow = () =>
    render(
        <TestProviders>
            <BufferSummaryRow
                buffers={[{ address: MEMORY_START, buffer_type: BufferType.L1, device_id: 0, size: MEMORY_END }]}
                memoryStart={MEMORY_START}
                memoryEnd={MEMORY_END}
                memoryPadding={0}
            />
        </TestProviders>,
    );

const getCanvas = () => document.querySelector('canvas') as HTMLCanvasElement;

beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: CANVAS_WIDTH,
        height: 20,
        right: CANVAS_WIDTH,
        bottom: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    } as DOMRect);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    recordEvent.mockClear();
});

describe('BufferSummaryRow drill-down events', () => {
    it('records one buffer_details drill-down for a click on a buffer', () => {
        renderRow();

        fireEvent.click(getCanvas(), { clientX: CANVAS_WIDTH / 2 });

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.DRILLDOWN_OPENED,
            details: { drilldown_target: DrilldownTarget.BUFFER_DETAILS },
        });
    });
});
