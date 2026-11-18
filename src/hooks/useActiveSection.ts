// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from 'react';

const ID_SEPARATOR = '|';
// Sub-pixel scroll positions can stop just short of the true bottom.
const PAGE_BOTTOM_TOLERANCE_PX = 1;

function isScrolledToBottom(scrollY: number): boolean {
    const { scrollHeight } = document.documentElement;

    // A page that cannot scroll has no bottom to reach, and every section is already in view.
    return scrollHeight > window.innerHeight && scrollY + window.innerHeight >= scrollHeight - PAGE_BOTTOM_TOLERANCE_PX;
}

function splitIds<TId extends string>(key: string): TId[] {
    return key ? (key.split(ID_SEPARATOR) as TId[]) : [];
}

export interface ScrollSpy<TId extends string> {
    /** The section being read: the one under the offset line, or the last one at the bottom of the page. */
    activeId: TId | null;
    /**
     * At the bottom of the page, every section whose top is in the viewport, in document order;
     * otherwise empty. On a tall viewport the sections before the last can be too short to scroll
     * up to the offset line, so they are never `activeId`, though they are in view.
     */
    sectionsInViewAtBottom: TId[];
}

export function useScrollSpy<TId extends string>(ids: TId[], offsetPx = 250): ScrollSpy<TId> {
    const [trackedId, setTrackedId] = useState<TId | null>(ids[0] ?? null);
    // Held as a joined key, so a scroll that leaves the same sections in view renders nothing.
    const [inViewAtBottomKey, setInViewAtBottomKey] = useState('');

    // The set of sections can change after mount (e.g. matmul/conv charts appear as data loads, or
    // comparison reports are toggled). Clamp during render so a stale id never leaks out: keep the
    // tracked section while it's still present, otherwise fall back to the first section.
    const activeId = trackedId !== null && ids.includes(trackedId) ? trackedId : (ids[0] ?? null);

    // Callers commonly pass a fresh array literal each render. Keying the effect on the joined
    // ids (rather than the array reference) keeps the scroll listener from re-subscribing on
    // every render, while still re-running when the actual set of sections changes.
    const idsKey = ids.join(ID_SEPARATOR);

    // Clamped like activeId, and stable between renders so callers can key effects on it.
    const sectionsInViewAtBottom = useMemo(() => {
        const sectionIds = splitIds<TId>(idsKey);

        return splitIds<TId>(inViewAtBottomKey).filter((id) => sectionIds.includes(id));
    }, [idsKey, inViewAtBottomKey]);

    useEffect(() => {
        const sectionIds = splitIds<TId>(idsKey);

        function navHighlighter() {
            const { scrollY, innerHeight } = window;
            const isAtBottom = isScrolledToBottom(scrollY);
            const inViewAtBottom: TId[] = [];
            let current: TId | null = null;

            sectionIds.forEach((id) => {
                const element = document.getElementById(id);

                if (element && element.offsetHeight > 0) {
                    const { top } = element.getBoundingClientRect();

                    // The last sections may be too short to scroll up to the offset line, so at
                    // the bottom of the page the last one rendered is the one being read.
                    if (isAtBottom) {
                        current = id;

                        if (top >= 0 && top < innerHeight) {
                            inViewAtBottom.push(id);
                        }

                        return;
                    }

                    const sectionHeight = element.offsetHeight;
                    // Measured from the top of the document, like scrollY: offsetTop is relative
                    // to the nearest positioned ancestor, such as the Performance charts container.
                    const sectionTop = top + scrollY - offsetPx;

                    if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                        current = id;
                    }
                }
            });

            if (current !== null) {
                setTrackedId(current);
            }

            setInViewAtBottomKey(inViewAtBottom.join(ID_SEPARATOR));
        }

        window.addEventListener('scroll', navHighlighter);
        navHighlighter();

        return () => window.removeEventListener('scroll', navHighlighter);
    }, [idsKey, offsetPx]);

    return { activeId, sectionsInViewAtBottom };
}

export function useActiveSection<TId extends string>(ids: TId[], offsetPx = 250): TId | null {
    return useScrollSpy(ids, offsetPx).activeId;
}
