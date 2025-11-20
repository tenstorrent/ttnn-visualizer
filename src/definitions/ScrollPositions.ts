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

export enum ScrollLocations {
    OPERATION_LIST = 'operation_list',
    TENSOR_LIST = 'tensor_list',
    BUFFER_SUMMARY = 'buffer_summary',
    BUFFER_SUMMARY_DRAM = 'buffer_summary_dram',
}

export interface ScrollPosition {
    [key: string]: VirtualListState;
}

// TODO: This is not quite the right place for this but we need to examine this file anyway after looking at tracking scroll positions
// Add tolerance for Chrome's sub-pixel rendering issues
export const SCROLL_TOLERANCE_PX = 1;
