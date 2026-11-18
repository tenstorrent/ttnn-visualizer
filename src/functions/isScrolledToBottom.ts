// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Sub-pixel layout, seen in Chrome, can leave a scroll position a fraction of a pixel short of
// where it was sent, such as the true bottom or a section's top.
export const SUBPIXEL_SCROLL_TOLERANCE_PX = 1;

/** Whether a scroller whose visible height is `viewportHeight` has reached the end of its content. */
export default function isScrolledToBottom(scrollTop: number, viewportHeight: number, scrollHeight: number): boolean {
    return scrollTop + viewportHeight >= scrollHeight - SUBPIXEL_SCROLL_TOLERANCE_PX;
}
