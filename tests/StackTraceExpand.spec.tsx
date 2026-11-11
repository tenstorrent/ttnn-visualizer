// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StackTrace from '../src/components/operation-details/StackTrace';
import { StackTraceLanguage } from '../src/definitions/StackTrace';
import { DrilldownTarget, EventLogEvent } from '../src/definitions/EventLogEvent';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

const renderStackTrace = (stackTrace: string) =>
    render(
        <StackTrace
            stackTrace={stackTrace}
            language={StackTraceLanguage.CPP}
            hideSourceButton
        />,
    );

beforeEach(() => {
    recordEvent.mockClear();
});

afterEach(cleanup);

describe('StackTrace expand toggle', () => {
    it('is hidden when the preview already shows the whole trace', () => {
        renderStackTrace("Operation 'ttnn.conv2d' started but never completed (likely crashed)");

        expect(screen.queryByRole('button', { name: /expand/i })).not.toBeInTheDocument();
    });

    it('is shown when the trace is longer than the preview', () => {
        renderStackTrace('line 1\nline 2\nline 3');

        expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
    });
});

describe('StackTrace drill-down event', () => {
    const stackTraceOpened = {
        event: EventLogEvent.DRILLDOWN_OPENED,
        details: { drilldown_target: DrilldownTarget.STACK_TRACE },
    };

    beforeEach(() => {
        // Collapsing scrolls the trace back into view, which jsdom does not implement.
        Element.prototype.scrollIntoView = vi.fn();
    });

    it('records each expansion and never a collapse', () => {
        renderStackTrace('line 1\nline 2\nline 3');

        fireEvent.click(screen.getByRole('button', { name: /expand/i }));
        fireEvent.click(screen.getByRole('button', { name: /collapse/i }));
        fireEvent.click(screen.getByRole('button', { name: /expand/i }));

        expect(recordEvent.mock.calls).toEqual([[stackTraceOpened], [stackTraceOpened]]);
    });

    it('records nothing for a trace shown expanded from the start', () => {
        render(
            <StackTrace
                stackTrace={'line 1\nline 2\nline 3'}
                language={StackTraceLanguage.CPP}
                isInitiallyExpanded
                hideSourceButton
            />,
        );

        expect(recordEvent).not.toHaveBeenCalled();
    });
});
