// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Pins the usage events of the operation error overlay: opening it records nothing, so a
 * stack trace is counted once, by the trace itself when it is expanded.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationDetailsNavigation from '../src/components/OperationDetailsNavigation';
import { DrilldownTarget, EventLogEvent } from '../src/definitions/EventLogEvent';
import { TestProviders } from './helpers/TestProviders';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

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
                stack_trace: 'frame 0\nframe 1\nframe 2',
                timestamp: '',
                rank: 0,
            },
        },
    }),
    usePreviousOperation: () => undefined,
    useNextOperation: () => undefined,
}));

const renderNavigation = () =>
    render(
        <TestProviders>
            <OperationDetailsNavigation
                operationId={OPERATION_ID}
                isLoading={false}
            />
        </TestProviders>,
    );

beforeEach(() => {
    recordEvent.mockClear();
});

// RTL auto-cleanup is off in this project.
afterEach(cleanup);

describe('OperationDetailsNavigation error overlay events', () => {
    it('records nothing when the error overlay is opened', async () => {
        renderNavigation();

        fireEvent.click(screen.getByRole('button', { name: 'View operation error' }));

        expect(await screen.findByRole('tab', { name: 'Error details' })).toBeInTheDocument();
        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('records one stack-trace drill-down when the trace in the overlay is expanded', async () => {
        renderNavigation();

        fireEvent.click(screen.getByRole('button', { name: 'View operation error' }));
        fireEvent.click(await screen.findByRole('button', { name: /expand/i }));

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.DRILLDOWN_OPENED,
            details: { drilldown_target: DrilldownTarget.STACK_TRACE },
        });
    });
});
