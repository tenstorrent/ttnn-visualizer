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

        const { result, rerender } = renderHook(
            ({ scrollY }) => {
                Object.defineProperty(window, 'scrollY', {
                    configurable: true,
                    value: scrollY,
                    writable: true,
                });

                return useActiveSection(['first', 'second']);
            },
            { initialProps: { scrollY: 200 } },
        );

        act(() => {
            rerender({ scrollY: 200 });
            window.dispatchEvent(new Event('scroll'));
        });

        expect(result.current).toBe('first');

        act(() => {
            rerender({ scrollY: 500 });
            window.dispatchEvent(new Event('scroll'));
        });

        expect(result.current).toBe('second');
    });

    it('uses the provided scroll offset when determining the active section', () => {
        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'section') {
                return mockElement(400, 200);
            }

            return null;
        });

        const { result, rerender } = renderHook(
            ({ scrollY }) => {
                Object.defineProperty(window, 'scrollY', {
                    configurable: true,
                    value: scrollY,
                    writable: true,
                });

                return useActiveSection(['section'], SCROLL_OFFSET_PX);
            },
            { initialProps: { scrollY: SCROLL_OFFSET_PX + 100 } },
        );

        act(() => {
            rerender({ scrollY: SCROLL_OFFSET_PX + 100 });
            window.dispatchEvent(new Event('scroll'));
        });

        expect(result.current).toBe('section');
    });
});
