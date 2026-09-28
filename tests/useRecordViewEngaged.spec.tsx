// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ROUTES from '../src/definitions/Routes';
import { EventLogView } from '../src/definitions/EventLogEvent';
import useRecordViewEngaged, { VIEW_ENGAGEMENT_THRESHOLD_MS } from '../src/hooks/useRecordViewEngaged';
import { modalNavigationState } from '../src/functions/modalRoute';

const { recordViewEngaged } = vi.hoisted(() => ({ recordViewEngaged: vi.fn() }));

vi.mock('../src/functions/eventLogViews', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/functions/eventLogViews')>();
    return { ...actual, recordViewEngaged };
});

function EngagementHarness() {
    const viewContainerRef = useRef<HTMLElement>(null);
    useRecordViewEngaged(viewContainerRef);
    const location = useLocation();
    const navigate = useNavigate();

    return (
        <>
            <button
                type='button'
                onClick={() => navigate(ROUTES.TENSORS)}
            >
                Open tensors
            </button>
            <button
                type='button'
                onClick={() => navigate(ROUTES.CLUSTER, modalNavigationState(location))}
            >
                Open topology
            </button>
            <main ref={viewContainerRef}>
                <button
                    type='button'
                    onClick={() => navigate(`${ROUTES.OPERATIONS}?filter=active`)}
                >
                    Change query
                </button>
                <button type='button'>View action</button>
                <button
                    type='button'
                    onClick={() => navigate(-1)}
                >
                    Close topology
                </button>
            </main>
        </>
    );
}

const renderRecorder = (initialEntry: string) =>
    render(
        <StrictMode>
            <MemoryRouter initialEntries={[initialEntry]}>
                <EngagementHarness />
            </MemoryRouter>
        </StrictMode>,
    );

describe('useRecordViewEngaged', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        recordViewEngaged.mockClear();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('records after an interaction followed by ten seconds open', () => {
        renderRecorder(ROUTES.OPERATIONS);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'View action' }));

        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        expect(recordViewEngaged).toHaveBeenCalledTimes(1);
        expect(recordViewEngaged).toHaveBeenCalledWith(EventLogView.OPERATIONS);
    });

    it('records when the first interaction follows the threshold', () => {
        renderRecorder(ROUTES.PERFORMANCE);
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        expect(recordViewEngaged).not.toHaveBeenCalled();

        fireEvent.keyDown(screen.getByRole('button', { name: 'View action' }), { key: 'Enter' });

        expect(recordViewEngaged).toHaveBeenCalledTimes(1);
        expect(recordViewEngaged).toHaveBeenCalledWith(EventLogView.PERFORMANCE);
    });

    it('records at most once for one view visit', () => {
        renderRecorder(ROUTES.OPERATIONS);
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        const viewAction = screen.getByRole('button', { name: 'View action' });
        fireEvent.pointerDown(viewAction);
        fireEvent.keyDown(viewAction, { key: 'Enter' });

        expect(recordViewEngaged).toHaveBeenCalledTimes(1);
    });

    it('ignores movement, hover, and scrolling', () => {
        renderRecorder(ROUTES.OPERATIONS);
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        const viewAction = screen.getByRole('button', { name: 'View action' });
        fireEvent.mouseMove(viewAction);
        fireEvent.mouseOver(viewAction);
        fireEvent.scroll(viewAction);

        expect(recordViewEngaged).not.toHaveBeenCalled();
    });

    it('removes interaction listeners after the first interaction', () => {
        renderRecorder(ROUTES.OPERATIONS);
        const viewContainer = screen.getByRole('main');
        const removeEventListener = vi.spyOn(viewContainer, 'removeEventListener');

        fireEvent.pointerDown(screen.getByRole('button', { name: 'View action' }));

        expect(removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
        expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
        removeEventListener.mockRestore();
    });

    it('resets the threshold when the pathname changes', () => {
        renderRecorder(ROUTES.OPERATIONS);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'View action' }));
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS - 1);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Open tensors' }));
        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(recordViewEngaged).not.toHaveBeenCalled();

        fireEvent.pointerDown(screen.getByRole('button', { name: 'View action' }));
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS - 1);
        });

        expect(recordViewEngaged).toHaveBeenCalledTimes(1);
        expect(recordViewEngaged).toHaveBeenCalledWith(EventLogView.TENSORS);
    });

    it('does not reset for a query-only change', () => {
        renderRecorder(ROUTES.OPERATIONS);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'View action' }));
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS - 1);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Change query' }));
        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(recordViewEngaged).toHaveBeenCalledTimes(1);
        expect(recordViewEngaged).toHaveBeenCalledWith(EventLogView.OPERATIONS);
    });

    it('does not record excluded routes', () => {
        renderRecorder(ROUTES.STYLEGUIDE);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'View action' }));
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        expect(recordViewEngaged).not.toHaveBeenCalled();
    });

    it('cancels the threshold when unmounted', () => {
        const { unmount } = renderRecorder(ROUTES.OPERATIONS);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'View action' }));

        unmount();
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        expect(recordViewEngaged).not.toHaveBeenCalled();
    });

    it('ignores interaction with global navigation', () => {
        renderRecorder(ROUTES.OPERATIONS);
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        const openTensors = screen.getByRole('button', { name: 'Open tensors' });
        fireEvent.pointerDown(openTensors);
        fireEvent.click(openTensors);

        expect(recordViewEngaged).not.toHaveBeenCalled();
    });

    it('preserves the background visit when returning from a modal', () => {
        renderRecorder(ROUTES.OPERATIONS);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'View action' }));
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS - 1_000);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Open topology' }));
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Close topology' }));
        act(() => {
            vi.advanceTimersByTime(999);
        });

        expect(recordViewEngaged).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(recordViewEngaged).toHaveBeenCalledTimes(1);
        expect(recordViewEngaged).toHaveBeenCalledWith(EventLogView.OPERATIONS);

        fireEvent.click(screen.getByRole('button', { name: 'Open topology' }));
        fireEvent.click(screen.getByRole('button', { name: 'Close topology' }));
        fireEvent.pointerDown(screen.getByRole('button', { name: 'View action' }));

        expect(recordViewEngaged).toHaveBeenCalledTimes(1);
    });
});
