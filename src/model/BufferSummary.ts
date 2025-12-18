// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { TensorWithSize } from './APIData';

export type TensorsByOperationByAddress = Map<number, Map<number, TensorWithSize>>;

export interface TensorDeallocationReport {
    id: number;
    address: number;
    lastOperationId: number;
    lastConsumerOperationId: number;
    consumerName: string;
}
