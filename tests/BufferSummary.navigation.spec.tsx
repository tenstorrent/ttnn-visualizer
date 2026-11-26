// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BufferSummary from '../src/routes/BufferSummary';
import { SECTION_IDS } from '../src/definitions/BufferSummary';
import { TestProviders } from './helpers/TestProviders';

// The real scroll-spy: what is pinned here is that following it re-renders the buttons alone.
const { renderTab } = vi.hoisted(() => ({ renderTab: vi.fn() }));

vi.mock('../src/components/buffer-summary/BufferSummaryTab', () => ({
    default: () => {
        renderTab();

        return null;
    },
}));
vi.mock('../src/components/buffer-summary/L1PeakComposition', () => ({ default: () => null }));
vi.mock('../src/hooks/useAPI', () => ({ useGetClusterDescription: () => ({ data: undefined }) }));

const VIEWPORT_HEIGHT_PX = 800;
const PAGE_HEIGHT_PX = 3000;
const BOTTOM_SCROLL_Y = PAGE_HEIGHT_PX - VIEWPORT_HEIGHT_PX;

// A tall plot above a table too short to scroll up to the offset line.
const SECTION_TOPS: Record<string, number> = { [SECTION_IDS.PLOT]: 200, [SECTION_IDS.TABLE]: 2400 };

function scrollTo(scrollY: number): void {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY, writable: true });
    act(() => {
        window.dispatchEvent(new Event('scroll'));
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    renderTab.mockClear();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
});

describe('BufferSummary navigation', () => {
    it('highlights the table at the bottom of the page without re-rendering the tab', () => {
        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (!(id in SECTION_TOPS)) {
                return null;
            }

            const element = document.createElement('div');

            Object.defineProperty(element, 'offsetHeight', { configurable: true, value: 600 });
            vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
                () => ({ top: SECTION_TOPS[id] - window.scrollY, height: 600 }) as DOMRect,
            );

            return element;
        });
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT_PX);
        vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(PAGE_HEIGHT_PX);

        render(
            <TestProviders>
                <BufferSummary />
            </TestProviders>,
        );
        const tabRendersOnArrival = renderTab.mock.calls.length;

        [BOTTOM_SCROLL_Y, BOTTOM_SCROLL_Y - 2, BOTTOM_SCROLL_Y].forEach(scrollTo);

        expect(screen.getByRole('button', { name: /Table view/ })).not.toHaveClass('bp6-outlined');
        expect(screen.getByRole('button', { name: /Plot view/ })).toHaveClass('bp6-outlined');
        expect(renderTab).toHaveBeenCalledTimes(tabRendersOnArrival);
    });
});
