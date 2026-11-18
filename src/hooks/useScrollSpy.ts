// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from 'react';
import isScrolledToBottom, { SUBPIXEL_SCROLL_TOLERANCE_PX } from '../functions/isScrolledToBottom';

const ID_SEPARATOR = '|';

function splitIds<TId extends string>(key: string): TId[] {
    return key ? (key.split(ID_SEPARATOR) as TId[]) : [];
}

export interface ScrollSpy<TId extends string> {
    /**
     * The section being read: the one under the offset line, or the last one at the bottom of the
     * page. The first section until another is found, and the last one found while the offset line
     * is in a gap between sections.
     */
    activeId: TId | null;
    /**
     * The sections in view as of the last measurement, in `ids` order: the one under the offset line,
     * or the first while the offset line is above it, and, when the page is at its bottom or cannot
     * scroll, every section whose top is in the viewport. On a tall viewport the sections before the
     * last can be too short to scroll up to the offset line, so they are never `activeId` though they
     * are in view. Unlike `activeId` it holds only what the measurement found, so it is empty until
     * the first measurement and leaves out a section the offset line has passed into a gap below.
     */
    sectionsInView: TId[];
}

/**
 * Tracks which of the sections with these element ids is being read as the window scrolls. A
 * section is read once its top reaches `offsetPx` below the top of the window.
 */
export function useScrollSpy<TId extends string>(ids: TId[], offsetPx = 250): ScrollSpy<TId> {
    const [trackedId, setTrackedId] = useState<TId | null>(ids[0] ?? null);
    // Held as a joined key, so a scroll that leaves the same sections in view renders nothing. Null
    // until the first measurement.
    const [inViewKey, setInViewKey] = useState<string | null>(null);

    // The set of sections can change after mount (e.g. matmul/conv charts appear as data loads, or
    // comparison reports are toggled). Clamp during render so a stale id never leaks out: keep the
    // tracked section while it's still present, otherwise fall back to the first section.
    const activeId = trackedId !== null && ids.includes(trackedId) ? trackedId : (ids[0] ?? null);

    // Callers commonly pass a fresh array literal each render. Keying the effect on the joined
    // ids (rather than the array reference) keeps the scroll listener from re-subscribing on
    // every render, while still re-running when the actual set of sections changes.
    const idsKey = ids.join(ID_SEPARATOR);

    // Clamped to the current ids like activeId, and stable between renders so callers can key
    // effects on it.
    const sectionsInView = useMemo(() => {
        if (inViewKey === null) {
            return [];
        }

        const inView = new Set(splitIds<TId>(inViewKey));

        return splitIds<TId>(idsKey).filter((id) => inView.has(id));
    }, [idsKey, inViewKey]);

    useEffect(() => {
        const sectionIds = splitIds<TId>(idsKey);

        function navHighlighter() {
            const { scrollY, innerHeight } = window;
            const { scrollHeight } = document.documentElement;
            const canScroll = scrollHeight > innerHeight;
            const isAtBottom = canScroll && isScrolledToBottom(scrollY, innerHeight, scrollHeight);
            // A page that cannot scroll is all in view at once, so it lists its sections too.
            const isAtEnd = isAtBottom || !canScroll;
            const inView = new Set<TId>();
            let current: TId | null = null;
            let firstRenderedId: TId | null = null;
            let isAboveFirstSection = false;

            sectionIds.forEach((id) => {
                const element = document.getElementById(id);

                if (element && element.offsetHeight > 0) {
                    const { top } = element.getBoundingClientRect();

                    // At the end of the page no section lies below the viewport, so a top at or
                    // below the top of the window is a top in view.
                    if (isAtEnd && top >= 0) {
                        inView.add(id);
                    }

                    // The last sections may be too short to scroll up to the offset line, so at
                    // the bottom of the page the last one rendered is the one being read.
                    if (isAtBottom) {
                        current = id;
                        return;
                    }

                    const sectionHeight = element.offsetHeight;
                    // Measured from the top of the document, like scrollY: offsetTop is relative
                    // to the nearest positioned ancestor, such as the Performance charts container.
                    const sectionTop = top + scrollY - offsetPx;
                    // A jump scrolls a section's top onto the offset line, or a fraction of a pixel
                    // short of it when the top is fractional, so the tolerance counts that as read.
                    // The section before it ended a whole margin above.
                    const readFrom = sectionTop - SUBPIXEL_SCROLL_TOLERANCE_PX;

                    if (firstRenderedId === null) {
                        firstRenderedId = id;
                        isAboveFirstSection = scrollY < readFrom;
                    }

                    if (scrollY >= readFrom && scrollY <= sectionTop + sectionHeight) {
                        current = id;
                    }
                }
            });

            // Above the first section the page opens on it, so it is the one being read. In a gap
            // between sections nothing is, and the highlight stays where it was.
            const read: TId | null = current ?? (isAboveFirstSection ? firstRenderedId : null);

            if (read !== null) {
                setTrackedId(read);
                inView.add(read);
            }

            setInViewKey(sectionIds.filter((id) => inView.has(id)).join(ID_SEPARATOR));
        }

        window.addEventListener('scroll', navHighlighter);
        navHighlighter();

        return () => window.removeEventListener('scroll', navHighlighter);
    }, [idsKey, offsetPx]);

    return { activeId, sectionsInView };
}
