// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export interface Operation {
    id: number;
    name: string;
    inputs: Tensor[];
    outputs: Tensor[];
}

export interface Tensor {
    id: number;
    producers: number[];
    consumers: number[];
}
