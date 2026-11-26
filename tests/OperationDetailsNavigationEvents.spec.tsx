// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Pins the usage events of the operation error overlay: opening it records nothing, so a
 * stack trace is counted once, by the trace itself when it is expanded, or on switching to
 * it when it opens already expanded.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationDetailsNavigation from '../src/components/OperationDetailsNavigation';
import { DrilldownTarget, EventLogEvent } from '../src/definitions/EventLogEvent';
import { TestProviders } from './helpers/TestProviders';

const { recordEvent, errorTrace } = vi.hoisted(() => ({
    recordEvent: vi.fn(),
    errorTrace: { stackTrace: '' as string | null },
}));

const LONG_TRACE = 'frame 0\nframe 1\nframe 2';

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

const OPERATION_ID = 1;

vi.mock('../src/hooks/useAPI', () => ({
    useOperationDetails: (operationId: number) => ({
        operation: {
            id: operationId,
            name: 'ttnn.add',
            error: {
                error_type: 'RuntimeError',
                error_message: 'boom\nmore detail\neven more detail',
                stack_trace: errorTrace.stackTrace,
                timestamp: '',
                rank: 0,
            },
        },
    }),
    usePreviousOperation: () => undefined,
    useNextOperation: () => undefined,
}));

// A fresh element each call, so `rerender` re-renders rather than bailing out on identical props.
const navigationTree = () => (
    <TestProviders>
        <OperationDetailsNavigation
            operationId={OPERATION_ID}
            isLoading={false}
        />
    </TestProviders>
);

const renderNavigation = () => render(navigationTree());

beforeEach(() => {
    recordEvent.mockClear();
    errorTrace.stackTrace = LONG_TRACE;
});

const STACK_TRACE_DRILLDOWN = {
    event: EventLogEvent.DRILLDOWN_OPENED,
    details: { drilldown_target: DrilldownTarget.STACK_TRACE },
};

const openTraceAfterExpandingMessage = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'View operation error' }));
    expect(await screen.findByRole('tab', { name: 'Error details', selected: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Stack Trace' }));
    expect(await screen.findByRole('tab', { name: 'Stack Trace', selected: true })).toBeInTheDocument();
};

// RTL auto-cleanup is off in this project.
afterEach(cleanup);

describe('OperationDetailsNavigation error overlay events', () => {
    it('records nothing when the error overlay is opened', async () => {
        renderNavigation();

        fireEvent.click(screen.getByRole('button', { name: 'View operation error' }));

        expect(await screen.findByRole('tab', { name: 'Error details' })).toBeInTheDocument();
        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('records nothing when the error message in the overlay is expanded', async () => {
        renderNavigation();

        fireEvent.click(screen.getByRole('button', { name: 'View operation error' }));
        expect(await screen.findByRole('tab', { name: 'Error details', selected: true })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /expand/i }));

        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('records one stack-trace drill-down when the trace in the overlay is expanded', async () => {
        renderNavigation();

        fireEvent.click(screen.getByRole('button', { name: 'View operation error' }));
        fireEvent.click(await screen.findByRole('tab', { name: 'Stack Trace' }));
        expect(await screen.findByRole('tab', { name: 'Stack Trace', selected: true })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /expand/i }));

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(STACK_TRACE_DRILLDOWN);
    });

    it('records one stack-trace drill-down when the trace opens already expanded', async () => {
        renderNavigation();

        // The tabs share the expanded state, so the trace mounts expanded with no Expand click.
        await openTraceAfterExpandingMessage();

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(STACK_TRACE_DRILLDOWN);
    });

    it('records nothing more for a click on the Stack Trace tab already open', async () => {
        renderNavigation();

        await openTraceAfterExpandingMessage();
        fireEvent.click(screen.getByRole('tab', { name: 'Stack Trace' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Stack Trace' }));

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(STACK_TRACE_DRILLDOWN);
    });

    it('records nothing on switching to a trace short enough for the preview, which has nothing to expand', async () => {
        errorTrace.stackTrace = 'frame 0\nframe 1';
        renderNavigation();

        await openTraceAfterExpandingMessage();

        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('records nothing when the trace is opened with the message collapsed', async () => {
        renderNavigation();

        fireEvent.click(screen.getByRole('button', { name: 'View operation error' }));
        fireEvent.click(await screen.findByRole('tab', { name: 'Stack Trace' }));
        expect(await screen.findByRole('tab', { name: 'Stack Trace', selected: true })).toBeInTheDocument();

        expect(recordEvent).not.toHaveBeenCalled();
    });
});

describe('OperationDetailsNavigation error overlay without a stack trace', () => {
    it.each([
        ['null', null],
        ['empty', ''],
    ])('shows only the error details when the trace is %s', async (_case, trace) => {
        errorTrace.stackTrace = trace;
        renderNavigation();

        fireEvent.click(screen.getByRole('button', { name: 'View operation error' }));

        expect(await screen.findByRole('tab', { name: 'Error details', selected: true })).toBeInTheDocument();
        expect(screen.getByText(/boom/)).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Stack Trace' })).not.toBeInTheDocument();
    });

    it('falls back to the error details when the Stack Trace tab it had open has no trace', async () => {
        const { rerender } = renderNavigation();

        fireEvent.click(screen.getByRole('button', { name: 'View operation error' }));
        fireEvent.click(await screen.findByRole('tab', { name: 'Stack Trace' }));
        expect(await screen.findByRole('tab', { name: 'Stack Trace', selected: true })).toBeInTheDocument();

        // The component stays mounted across prev/next, so its chosen tab outlives the operation.
        errorTrace.stackTrace = null;
        rerender(navigationTree());

        expect(await screen.findByRole('tab', { name: 'Error details', selected: true })).toBeInTheDocument();
        expect(screen.getByText(/boom/)).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: 'Stack Trace' })).not.toBeInTheDocument();
    });
});
