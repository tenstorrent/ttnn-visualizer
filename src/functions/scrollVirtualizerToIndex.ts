// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

type ScrollAlign = 'start' | 'center' | 'end' | 'auto';

export interface ScrollToIndexVirtualizer {
    scrollToIndex: (index: number, options?: { align?: ScrollAlign }) => void;
}

/**
 * TanStack Virtual can no-op a single `scrollToIndex` when the scroll element or
 * item measurements are not ready yet. Calling twice in the same turn is the
 * established workaround; callers that still need a paint first (tab switch,
 * empty measurements) schedule this inside `requestAnimationFrame` themselves.
 */
export function scrollVirtualizerToIndex(
    virtualizer: ScrollToIndexVirtualizer,
    index: number,
    options: { align?: ScrollAlign } = {},
): void {
    const scrollOptions = { align: options.align ?? 'start' };
    virtualizer.scrollToIndex(index, scrollOptions);
    virtualizer.scrollToIndex(index, scrollOptions);
}
