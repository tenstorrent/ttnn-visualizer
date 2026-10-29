// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useRef, useState } from 'react';

/**
 * Tracks an element's content width, rounded to whole pixels, through a callback ref.
 *
 * Blueprint 6.21's sliders measure their track only on mount and when `min`, `max` or `vertical`
 * change, so a slider mounted while hidden, or whose container later resizes, converts pointer
 * positions with a stale width. Passing this width as the slider's `key` remounts it at the new size.
 * The width stays 0 where `ResizeObserver` is unavailable (jsdom).
 */
const useObservedWidth = () => {
    const [width, setWidth] = useState(0);
    const observerRef = useRef<ResizeObserver | null>(null);

    const ref = useCallback((element: HTMLElement | null) => {
        observerRef.current?.disconnect();
        observerRef.current = null;

        if (element && typeof window.ResizeObserver === 'function') {
            observerRef.current = new window.ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
            observerRef.current.observe(element);
        }
    }, []);

    return [ref, width] as const;
};

export default useObservedWidth;
