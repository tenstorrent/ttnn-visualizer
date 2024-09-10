// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { BufferType } from './BufferType';

export interface Operation {
    id: number;
    name: string;
    inputs: Tensor[];
    outputs: Tensor[];
}

export interface Tensor {
    address: number | null;
    id: number;
    buffer_type: BufferType | null;
    producers: number[];
    consumers: number[];
    producerNames: string[];
    consumerNames: string[];
}

// TODO: if this data proves itself pointless, we should remove it
export interface HistoricalTensor extends Tensor {
    parentOperationId: number;
    historical: boolean; // will this be used?
}
