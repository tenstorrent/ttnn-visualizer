// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface CoreCoord {
    x: number;
    y: number;
}

// Expansions of a `core_range_set` are cached and handed to every caller that
// passes the same string, so the elements are shared. #1844
export type CoreCoordList = readonly Readonly<CoreCoord>[];
