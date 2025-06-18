// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum ScrollLocations {
    BUFFER_SUMMARY = 'buffer_summary',
}

export interface ScrollPositions {
    [key: string]: { index: number };
}
