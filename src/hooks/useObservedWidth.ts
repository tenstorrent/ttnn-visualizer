// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useRef, useState } from 'react';

/**
 * Tracks an element's content width, rounded to whole pixels, through a callback ref. The width stays 0 where
 * `ResizeObserver` is unavailable (jsdom). Use `RemountOnResize` to remount a slider when its width changes.
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
