// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { VirtualItem } from '@tanstack/react-virtual';

export interface VirtualListState {
    scrollOffset: number;
    itemCount: number;
    measurementsCache: VirtualItem[];
}
