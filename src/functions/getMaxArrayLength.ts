// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export default function getMaxArrayLength(arrays: Array<unknown[]>, comparisonReport: string | null): number {
    // If a comparison report is provided, add 1 to the max length to avoid data being cut off when plotting the grouped bars
    return Math.max(...arrays.map((arr) => arr.length), 0) + (comparisonReport ? 1 : 0);
}
