// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { VirtualItem } from '@tanstack/react-virtual';

export interface VirtualListState {
    scrollOffset: number;
    measurementsCache: VirtualItem[];
    expandedItems: number[];
}

export interface ListStates {
    [key: string]: VirtualListState;
}

export enum ScrollLocations {
    OPERATION_LIST = 'operation_list',
    TENSOR_LIST = 'tensor_list',
    BUFFER_SUMMARY = 'buffer_summary',
    BUFFER_SUMMARY_DRAM = 'buffer_summary_dram',
}
