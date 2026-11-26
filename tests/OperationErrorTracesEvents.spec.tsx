// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Pins which of the two blocks in `OperationErrorTraces` records a stack-trace drill-down:
 * the trace does when expanded, the error message never does.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationErrorTraces from '../src/components/OperationErrorTraces';
import { DrilldownTarget, EventLogEvent } from '../src/definitions/EventLogEvent';
import { OperationError } from '../src/model/APIData';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

// Both long enough to need an Expand button.
const ERROR: OperationError = {
    error_type: 'RuntimeError',
    error_message: 'boom\nmore detail\neven more detail\nand more',
    stack_trace: 'frame 0\nframe 1\nframe 2\nframe 3',
    timestamp: '',
    rank: 0,
};

// Each block is a `.stack-trace` whose title names it.
const expandBlock = (title: string) => {
    const block = screen.getByText(title).closest('.stack-trace') as HTMLElement;

    fireEvent.click(within(block).getByRole('button', { name: /expand/i }));
};

beforeEach(() => {
    recordEvent.mockClear();
});

// RTL auto-cleanup is off in this project.
afterEach(cleanup);

describe('OperationErrorTraces events', () => {
    it('records nothing when the error message is expanded', () => {
        render(<OperationErrorTraces error={ERROR} />);

        expandBlock('Error Message');

        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('records one stack-trace drill-down when the stack trace is expanded', () => {
        render(<OperationErrorTraces error={ERROR} />);

        expandBlock('Error Stack Trace');

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.DRILLDOWN_OPENED,
            details: { drilldown_target: DrilldownTarget.STACK_TRACE },
        });
    });
});
