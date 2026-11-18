// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Sub-pixel scroll positions, seen in Chrome, can stop just short of the true bottom.
export const SCROLL_BOTTOM_TOLERANCE_PX = 1;

/** Whether a scroller whose visible height is `viewportHeight` has reached the end of its content. */
export default function isScrolledToBottom(scrollTop: number, viewportHeight: number, scrollHeight: number): boolean {
    return scrollTop + viewportHeight >= scrollHeight - SCROLL_BOTTOM_TOLERANCE_PX;
}
