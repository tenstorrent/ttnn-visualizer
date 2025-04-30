// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export default function getMaxArrayLength(arrays: Array<unknown[]>): number {
    return Math.max(...arrays.map((arr) => arr.length), 0);
}
