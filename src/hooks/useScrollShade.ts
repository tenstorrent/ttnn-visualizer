// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useState } from 'react';
import isScrolledToBottom, { SUBPIXEL_SCROLL_TOLERANCE_PX } from '../functions/isScrolledToBottom';

interface UseScrollShade {
    hasScrolledFromTop: boolean;
    hasScrolledToBottom: boolean;
    updateScrollShade: (scrollElement: HTMLElement) => void;
    resetScrollShade: () => void;
    shadeClasses: Record<'top' | 'bottom', string>;
}

const SHADE_CLASSES = {
    top: 'scroll-shade-top',
    bottom: 'scroll-shade-bottom',
};

const useScrollShade = (): UseScrollShade => {
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

    const updateScrollShade = useCallback((scrollElement: HTMLElement) => {
        const { scrollTop, offsetHeight, scrollHeight } = scrollElement;

        setHasScrolledFromTop(scrollTop > SUBPIXEL_SCROLL_TOLERANCE_PX);
        setHasScrolledToBottom(isScrolledToBottom(scrollTop, offsetHeight, scrollHeight));
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
        shadeClasses: SHADE_CLASSES,
    };
};

export default useScrollShade;
