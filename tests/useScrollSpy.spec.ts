// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollSpy } from '../src/hooks/useScrollSpy';

// Most cases are about the section being read alone.
const useActiveSection = (ids: string[], offsetPx?: number) => useScrollSpy(ids, offsetPx).activeId;

const SCROLL_OFFSET_PX = 250;

// `top` is the section's distance from the top of the document. jsdom has no layout, so the
// viewport-relative rect is derived from it and the scroll position at the time of the call.
// `offsetTop` defaults to `top`, as it is when no ancestor is positioned.
function mockElement(top: number, height: number, offsetTop = top): HTMLDivElement {
    const element = document.createElement('div');

    Object.defineProperty(element, 'offsetTop', {
        configurable: true,
        value: offsetTop,
    });
    Object.defineProperty(element, 'offsetHeight', {
        configurable: true,
        value: height,
    });
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
        () => ({ top: top - window.scrollY, height }) as DOMRect,
    );

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

describe('useScrollSpy', () => {
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

        // 'first' spans [150, 350] once the 250px offset is applied.
        scrollTo(200);
        expect(result.current).toBe('first');

        // 'second' spans [450, 650].
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

    it('places a section inside a positioned ancestor by its top in the document', () => {
        // Both sections sit in a container 800px down the page, so their offsetTop values are
        // relative to it and 800px short of where they are in the document.
        const CONTAINER_TOP_PX = 800;

        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'first') {
                return mockElement(CONTAINER_TOP_PX, 400, 0);
            }

            if (id === 'second') {
                return mockElement(CONTAINER_TOP_PX + 400, 400, 400);
            }

            return null;
        });

        const { result } = renderHook(() => useActiveSection(['first', 'second'], 60));

        // 'second' spans [1140, 1540] in the document; offsetTop alone would put it at [340, 740].
        scrollTo(600);
        expect(result.current).toBe('first');

        scrollTo(800);
        expect(result.current).toBe('first');

        scrollTo(1200);
        expect(result.current).toBe('second');
    });

    it('activates a section jumped to, whose top lands exactly on the offset line', () => {
        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'first') {
                return mockElement(400, 200);
            }

            // 60px below the first, as the charts' margin leaves them.
            if (id === 'second') {
                return mockElement(660, 200);
            }

            return null;
        });

        const { result } = renderHook(() => useActiveSection(['first', 'second'], 60));

        scrollTo(400);
        expect(result.current).toBe('first');

        // A jump scrolls the target's top to the offset line: 660 - 60. The first ended at 600 - 60.
        scrollTo(600);
        expect(result.current).toBe('second');
    });

    it('activates a section that sits flush with the top of the page', () => {
        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'first') {
                return mockElement(0, 400);
            }

            if (id === 'second') {
                return mockElement(700, 400);
            }

            return null;
        });

        const { result } = renderHook(() => useActiveSection(['first', 'second'], 60));

        // 'second' spans [640, 1040] once the 60px offset is applied.
        scrollTo(800);
        expect(result.current).toBe('second');

        // Back to the top: 'first' spans [-60, 340] and must still be reachable from the very top.
        scrollTo(0);
        expect(result.current).toBe('first');
    });

    it('drops a stale active id and re-seeds when the id set changes', () => {
        vi.spyOn(document, 'getElementById').mockReturnValue(null);

        const { result, rerender } = renderHook(({ ids }) => useActiveSection(ids), {
            initialProps: { ids: ['first', 'second'] },
        });

        expect(result.current).toBe('first');

        // The previous active id is gone from the new set, so it falls back to the new first section.
        rerender({ ids: ['third', 'fourth'] });
        expect(result.current).toBe('third');
    });

    it('keeps the current active id when it survives a change to the id set', () => {
        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'first') {
                return mockElement(400, 200);
            }

            if (id === 'second') {
                return mockElement(700, 200);
            }

            return null;
        });

        const { result, rerender } = renderHook(({ ids }) => useActiveSection(ids), {
            initialProps: { ids: ['first', 'second'] },
        });

        // 'second' spans [450, 650]; make it the active section before the id set grows.
        scrollTo(500);
        expect(result.current).toBe('second');

        // 'second' is still present, so adding a new section must not reset the active id.
        rerender({ ids: ['first', 'second', 'third'] });
        expect(result.current).toBe('second');
    });

    describe('at the bottom of the page', () => {
        const VIEWPORT_HEIGHT_PX = 800;
        const PAGE_HEIGHT_PX = 2000;
        const BOTTOM_SCROLL_Y = PAGE_HEIGHT_PX - VIEWPORT_HEIGHT_PX;

        beforeEach(() => {
            vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT_PX);
            vi.spyOn(document, 'getElementById').mockImplementation((id) => {
                // Two short sections at the end that can never reach the offset line.
                const element = {
                    first: mockElement(0, 1500),
                    second: mockElement(1600, 200),
                    third: mockElement(1800, 200),
                }[id];

                return element ?? null;
            });
        });

        it('makes the last section active, though it never reaches the offset line', () => {
            vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(PAGE_HEIGHT_PX);
            const { result } = renderHook(() => useActiveSection(['first', 'second', 'third']));

            scrollTo(BOTTOM_SCROLL_Y);

            expect(result.current).toBe('third');
        });

        it('leaves a page that cannot scroll on its first section', () => {
            vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT_PX);
            const { result } = renderHook(() => useActiveSection(['first', 'second', 'third']));

            scrollTo(0);

            expect(result.current).toBe('first');
        });

        it('lists every section of a page that cannot scroll, which is all in view', () => {
            vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT_PX);
            const { result } = renderHook(() => useScrollSpy(['first', 'second', 'third']));

            expect(result.current).toEqual({ activeId: 'first', sectionsInView: ['first', 'second', 'third'] });
        });

        describe('on a page that scrolls', () => {
            beforeEach(() => {
                vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(PAGE_HEIGHT_PX);
            });

            it('lists every section whose top is in view, though only the last becomes active', () => {
                const { result } = renderHook(() => useScrollSpy(['first', 'second', 'third']));

                scrollTo(BOTTOM_SCROLL_Y);

                // 'second' never reaches the offset line, so this list is its only way to count.
                expect(result.current).toEqual({ activeId: 'third', sectionsInView: ['second', 'third'] });
            });

            it('lists only the active section away from the bottom', () => {
                const { result } = renderHook(() => useScrollSpy(['first', 'second', 'third']));

                scrollTo(BOTTOM_SCROLL_Y);
                scrollTo(100);

                expect(result.current.sectionsInView).toEqual(['first']);
            });

            it('lists nothing before its first measurement', () => {
                const listed: string[][] = [];

                renderHook(() => {
                    const spy = useScrollSpy(['first', 'second', 'third']);

                    listed.push(spy.sectionsInView);

                    return spy;
                });

                // A page opened partway down must not report its first section before it is measured.
                expect(listed[0]).toEqual([]);
                expect(listed.at(-1)).toEqual(['first']);
            });

            it('never lists a section once it has left the id set', () => {
                const listed: string[][] = [];
                const { rerender } = renderHook(
                    ({ ids }) => {
                        const spy = useScrollSpy(ids);

                        listed.push(spy.sectionsInView);

                        return spy;
                    },
                    { initialProps: { ids: ['first', 'second', 'third'] } },
                );

                scrollTo(BOTTOM_SCROLL_Y);
                listed.length = 0;
                rerender({ ids: ['first', 'third'] });

                // Every render, including the one before the effect re-measures, leaves it out.
                expect(listed.length).toBeGreaterThan(0);
                listed.forEach((sections) => expect(sections).not.toContain('second'));
            });

            it('keeps the same list across renders that leave the same sections in view', () => {
                // A fresh array literal on each render, as callers commonly pass.
                const { result, rerender } = renderHook(() => useScrollSpy(['first', 'second', 'third']));

                scrollTo(BOTTOM_SCROLL_Y);
                const listed = result.current.sectionsInView;
                rerender();

                expect(result.current.sectionsInView).toBe(listed);
            });
        });
    });

    it('uses the provided scroll offset when determining the active section', () => {
        vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'section') {
                return mockElement(400, 200);
            }

            return null;
        });

        const { result } = renderHook(() => useActiveSection(['section'], SCROLL_OFFSET_PX));

        // With a 250px offset the section spans [150, 350]; 350 is the inclusive upper bound.
        scrollTo(SCROLL_OFFSET_PX + 100);
        expect(result.current).toBe('section');
    });
});
