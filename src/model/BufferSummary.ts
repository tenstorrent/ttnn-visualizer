// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { HistoricalTensor } from './Graph';

export type HistoricalTensorsByOperation = Map<number, Map<number, HistoricalTensor>>;
