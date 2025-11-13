// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useState } from 'react';
import { SCROLL_TOLERANCE_PX } from '../definitions/ScrollPositions';

interface UseScrollShadeReturn {
    hasScrolledFromTop: boolean;
    hasScrolledToBottom: boolean;
    updateScrollShade: (scrollElement: HTMLElement) => void;
    resetScrollShade: () => void;
}

/**
 * Custom hook to manage scroll shade state for scrollable elements
 * Tracks whether the user has scrolled from the top or reached the bottom
 */
export const useScrollShade = (): UseScrollShadeReturn => {
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

    const updateScrollShade = useCallback((scrollElement: HTMLElement) => {
        const { scrollTop, offsetHeight, scrollHeight } = scrollElement;
        const scrollBottom = scrollTop + offsetHeight;

        setHasScrolledFromTop(scrollTop > 0 + SCROLL_TOLERANCE_PX);
        setHasScrolledToBottom(scrollBottom >= scrollHeight - SCROLL_TOLERANCE_PX);
    }, []);

    const resetScrollShade = useCallback(() => {
        setHasScrolledFromTop(false);
        setHasScrolledToBottom(false);
    }, []);

    return {
        hasScrolledFromTop,
        hasScrolledToBottom,
        updateScrollShade,
        resetScrollShade,
    };
};

export default useScrollShade;
