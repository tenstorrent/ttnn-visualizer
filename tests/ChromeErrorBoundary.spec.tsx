// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * A render fault in the always-mounted footer used to reach the router's root `errorElement`,
 * replacing every route with the error page. The boundary keeps the fault inside the chrome, and
 * retries when the active report changes.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ChromeErrorBoundary from '../src/components/ChromeErrorBoundary';

const state = { shouldThrow: true };

function Chrome() {
    if (state.shouldThrow) {
        throw new Error('footer failed');
    }

    return <p>Footer</p>;
}

const renderFallback = (retry: () => void) => (
    <button
        type='button'
        onClick={retry}
    >
        Retry
    </button>
);

// React's development build re-dispatches a render error as a window `error` event, which jsdom
// reports as uncaught even though the boundary caught it
const suppressReportedError = (event: ErrorEvent) => event.preventDefault();

beforeEach(() => {
    state.shouldThrow = true;
    // React logs the caught error; keep the expected noise out of the test output
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener('error', suppressReportedError);
});

afterEach(() => {
    cleanup();
    window.removeEventListener('error', suppressReportedError);
    vi.restoreAllMocks();
});

it('shows the fallback in place of failed chrome and leaves the page alone', () => {
    render(
        <>
            <p>Page</p>
            <ChromeErrorBoundary
                resetKey='report-a'
                fallback={renderFallback}
            >
                <Chrome />
            </ChromeErrorBoundary>
        </>,
    );

    expect(screen.getByText('Page')).toBeInTheDocument();
    expect(screen.queryByText('Footer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

it('retries the chrome from the fallback', () => {
    render(
        <ChromeErrorBoundary
            resetKey='report-a'
            fallback={renderFallback}
        >
            <Chrome />
        </ChromeErrorBoundary>,
    );

    state.shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Footer')).toBeInTheDocument();
});

it('retries the chrome when the reset key changes', () => {
    const { rerender } = render(
        <ChromeErrorBoundary
            resetKey='report-a'
            fallback={renderFallback}
        >
            <Chrome />
        </ChromeErrorBoundary>,
    );

    expect(screen.queryByText('Footer')).not.toBeInTheDocument();

    state.shouldThrow = false;
    rerender(
        <ChromeErrorBoundary
            resetKey='report-a'
            fallback={renderFallback}
        >
            <Chrome />
        </ChromeErrorBoundary>,
    );

    expect(screen.queryByText('Footer')).not.toBeInTheDocument();

    rerender(
        <ChromeErrorBoundary
            resetKey='report-b'
            fallback={renderFallback}
        >
            <Chrome />
        </ChromeErrorBoundary>,
    );

    expect(screen.getByText('Footer')).toBeInTheDocument();
});
