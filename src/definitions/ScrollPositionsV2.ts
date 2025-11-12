// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { VirtualItem } from '@tanstack/react-virtual';

export interface VirtualListState {
    scrollOffset: number;
    itemCount: number;
    measurementsCache: VirtualItem[];
    expandedItems: number[];
}

export enum ScrollLocationsV2 {
    OPERATION_LIST = 'operation_list',
    TENSOR_LIST = 'tensor_list',
}

export interface ScrollPositionV2 {
    [key: string]: VirtualListState;
}

// TODO: This is not quite the right place for this but we need to examine this file anyway after looking at tracking scroll positions
// Add tolerance for Chrome's sub-pixel rendering issues
export const SCROLL_TOLERANCE_PX = 1;
