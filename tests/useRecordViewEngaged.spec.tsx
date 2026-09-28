// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ROUTES from '../src/definitions/Routes';
import { EventLogView } from '../src/definitions/EventLogEvent';
import useRecordViewEngaged, { VIEW_ENGAGEMENT_THRESHOLD_MS } from '../src/hooks/useRecordViewEngaged';

const { recordViewEngaged } = vi.hoisted(() => ({ recordViewEngaged: vi.fn() }));

vi.mock('../src/functions/eventLogViews', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/functions/eventLogViews')>();
    return { ...actual, recordViewEngaged };
});

function EngagementHarness() {
    useRecordViewEngaged();
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
                onClick={() => navigate(`${ROUTES.OPERATIONS}?filter=active`)}
            >
                Change query
            </button>
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
        fireEvent.pointerDown(document);

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

        fireEvent.keyDown(document, { key: 'Enter' });

        expect(recordViewEngaged).toHaveBeenCalledTimes(1);
        expect(recordViewEngaged).toHaveBeenCalledWith(EventLogView.PERFORMANCE);
    });

    it('records at most once for one view visit', () => {
        renderRecorder(ROUTES.OPERATIONS);
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        fireEvent.pointerDown(document);
        fireEvent.keyDown(document, { key: 'Enter' });

        expect(recordViewEngaged).toHaveBeenCalledTimes(1);
    });

    it('ignores movement, hover, and scrolling', () => {
        renderRecorder(ROUTES.OPERATIONS);
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        fireEvent.mouseMove(document);
        fireEvent.mouseOver(document);
        fireEvent.scroll(document);

        expect(recordViewEngaged).not.toHaveBeenCalled();
    });

    it('removes interaction listeners after the first interaction', () => {
        const removeEventListener = vi.spyOn(document, 'removeEventListener');
        renderRecorder(ROUTES.OPERATIONS);

        fireEvent.pointerDown(document);

        expect(removeEventListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
        expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
        removeEventListener.mockRestore();
    });

    it('resets the threshold when the pathname changes', () => {
        renderRecorder(ROUTES.OPERATIONS);
        fireEvent.pointerDown(document);
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS - 1);
        });

        fireEvent.click(screen.getByRole('button', { name: 'Open tensors' }));
        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(recordViewEngaged).not.toHaveBeenCalled();

        fireEvent.pointerDown(document);
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS - 1);
        });

        expect(recordViewEngaged).toHaveBeenCalledTimes(1);
        expect(recordViewEngaged).toHaveBeenCalledWith(EventLogView.TENSORS);
    });

    it('does not reset for a query-only change', () => {
        renderRecorder(ROUTES.OPERATIONS);
        fireEvent.pointerDown(document);
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
        fireEvent.pointerDown(document);
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        expect(recordViewEngaged).not.toHaveBeenCalled();
    });

    it('cancels the threshold when unmounted', () => {
        const { unmount } = renderRecorder(ROUTES.OPERATIONS);
        fireEvent.pointerDown(document);

        unmount();
        act(() => {
            vi.advanceTimersByTime(VIEW_ENGAGEMENT_THRESHOLD_MS);
        });

        expect(recordViewEngaged).not.toHaveBeenCalled();
    });
});
