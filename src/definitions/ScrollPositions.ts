// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum ScrollLocations {
    BUFFER_SUMMARY = 'buffer_summary',
}

export interface ScrollPositions {
    [key: string]: { index: number };
}

// TODO: This is not quite the right place for this but we need to examine this file anyway after looking at tracking scroll positions
// Add tolerance for Chrome's sub-pixel rendering issues
export const SCROLL_TOLERANCE_PX = 1;
