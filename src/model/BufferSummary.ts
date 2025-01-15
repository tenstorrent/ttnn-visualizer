// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Tensor } from './APIData';

export type TensorsByOperationByAddress = Map<number, Map<number, Tensor>>;
