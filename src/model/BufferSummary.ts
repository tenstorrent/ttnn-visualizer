// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Tensor } from './APIData';

export type TensorsByOperationByAddress = Map<number, Map<number, Tensor>>;

export interface TensorDeallocationReport {
    id: number;
    address: number;
    lastOperationId: number;
    lastConsumerOperationId: number;
    consumerName: string;
}
