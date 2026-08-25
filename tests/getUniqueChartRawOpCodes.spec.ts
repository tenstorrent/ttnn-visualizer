// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getUniqueChartRawOpCodes } from '../src/functions/getUniqueChartRawOpCodes';
import { TypedPerfTableRow } from '../src/model/PerfTable';

const row = (rawOpCode: string | null | undefined): TypedPerfTableRow =>
    ({ raw_op_code: rawOpCode }) as unknown as TypedPerfTableRow;

describe('getUniqueChartRawOpCodes', () => {
    it('returns unique string op codes and skips nullish values', () => {
        expect(
            getUniqueChartRawOpCodes([row('Matmul'), row(null), row(undefined), row('Conv2d'), row('Matmul')]),
        ).toEqual(['Matmul', 'Conv2d']);
    });

    it('skips empty strings', () => {
        expect(getUniqueChartRawOpCodes([row('')])).toEqual([]);
    });
});
