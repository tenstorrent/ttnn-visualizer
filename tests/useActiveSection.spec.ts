// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActiveSection } from '../src/hooks/useActiveSection';

const SCROLL_OFFSET_PX = 250;

function mockElement(top: number, height: number): HTMLDivElement {
    const element = document.createElement('div');

    Object.defineProperty(element, 'offsetTop', {
        configurable: true,
        value: top,
    });
    Object.defineProperty(element, 'offsetHeight', {
        configurable: true,
        value: height,
    });

    return element;
}

// Mirrors a real scroll: move the viewport, then fire the event the hook listens for.
function scrollTo(scrollY: number): void {
    Object.defineProperty(window, 'scrollY', {
        configurable: true,
        value: scrollY,
        writable: true,
    });

    act(() => {
        window.dispatchEvent(new Event('scroll'));
    });
}

describe('useActiveSection', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'scrollY', {
            configurable: true,
            value: 0,
            writable: true,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the first section id by default', () => {
        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'first') {
                return mockElement(400, 200);
            }

            if (id === 'second') {
                return mockElement(700, 200);
            }

            return null;
        });

        const { result } = renderHook(() => useActiveSection(['first', 'second']));

        expect(result.current).toBe('first');
    });

    it('selects the section whose scroll range contains scrollY', () => {
        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'first') {
                return mockElement(400, 200);
            }

            if (id === 'second') {
                return mockElement(700, 200);
            }

            return null;
        });

        const { result } = renderHook(() => useActiveSection(['first', 'second']));

        // 'first' spans (150, 350] once the 250px offset is applied.
        scrollTo(200);
        expect(result.current).toBe('first');

        // 'second' spans (450, 650].
        scrollTo(500);
        expect(result.current).toBe('second');
    });

    it('does not change the active section when scrollY falls outside every section range', () => {
        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'first') {
                return mockElement(400, 200);
            }

            if (id === 'second') {
                return mockElement(700, 200);
            }

            return null;
        });

        const { result } = renderHook(() => useActiveSection(['first', 'second']));

        scrollTo(500);
        expect(result.current).toBe('second');

        // 5000 is past both ranges; the hook keeps the last matched section rather than clearing it.
        scrollTo(5000);
        expect(result.current).toBe('second');
    });

    it('uses the provided scroll offset when determining the active section', () => {
        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'section') {
                return mockElement(400, 200);
            }

            return null;
        });

        const { result } = renderHook(() => useActiveSection(['section'], SCROLL_OFFSET_PX));

        // With a 250px offset the section spans (150, 350]; 350 is the inclusive upper bound.
        scrollTo(SCROLL_OFFSET_PX + 100);
        expect(result.current).toBe('section');
    });
});
