// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export interface Operation {
    id: number;
    name: string;
    arguments: { name: string; value: string }[];
}
