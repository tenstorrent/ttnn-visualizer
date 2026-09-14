// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type NumberRange } from '@blueprintjs/core';

/**
 * Both bounds are inclusive, and both are compared — never tested for truthiness.
 * An operation id of 0 is legitimate, so `range[0] && …` drops the whole list. #1999
 */
export const filterByOperationRange = <T extends { id: number }>(items: T[], range: NumberRange): T[] =>
    items.filter((item) => item.id >= range[0] && item.id <= range[1]);
