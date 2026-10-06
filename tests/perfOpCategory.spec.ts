// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { BoundType } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { OperationCategories } from '../src/definitions/StackedPerfTable';
import { TypedPerfTableRow, signpostRowDefaults } from '../src/model/PerfTable';
import { MAX_LISTED_OTHER_OPS, getOpCategoryBreakdown } from '../src/functions/perfOpCategory';

const makeRow = (
    id: string,
    opCategory: OperationCategories | null,
    deviceTime: number | null,
    overrides: Partial<TypedPerfTableRow> = {},
): TypedPerfTableRow =>
    ({
        id,
        op_type: OpType.DEVICE_OP,
        op_code: `Op${id}`,
        raw_op_code: `Op${id}`,
        op_category: opCategory,
        device_time: deviceTime,
        ...overrides,
    }) as TypedPerfTableRow;

describe('getOpCategoryBreakdown', () => {
    it('shares device time out by category, with unclassified time kept apart from Other', () => {
        const breakdown = getOpCategoryBreakdown([
            makeRow('1', OperationCategories.COMPUTE, 50),
            makeRow('2', OperationCategories.CCL, 20),
            makeRow('3', OperationCategories.OTHER, 20),
            makeRow('4', null, 10),
        ]);

        expect(breakdown?.percentByCategory).toEqual({
            [OperationCategories.COMPUTE]: 50,
            [OperationCategories.CCL]: 20,
            [OperationCategories.DM]: 0,
            [OperationCategories.TM]: 0,
            [OperationCategories.OTHER]: 20,
        });
        expect(breakdown?.unclassifiedPercent).toBe(10);
    });

    it('counts only rows with device time, so signposts and host ops do not dilute the shares', () => {
        const breakdown = getOpCategoryBreakdown([
            makeRow('1', OperationCategories.TM, 30),
            makeRow('2', OperationCategories.HOST, null, { bound: BoundType.HOST }),
            { ...signpostRowDefaults, id: '3', op_code: '(signpost)' } as unknown as TypedPerfTableRow,
            makeRow('4', null, null, { missing: true }),
        ]);

        expect(breakdown?.percentByCategory[OperationCategories.TM]).toBe(100);
        expect(breakdown?.unclassifiedPercent).toBe(0);
        expect(breakdown?.hasHostOps).toBe(true);
    });

    it('returns null when there is no device time to share out', () => {
        expect(getOpCategoryBreakdown([])).toBeNull();
        expect(getOpCategoryBreakdown([makeRow('1', OperationCategories.HOST, null)])).toBeNull();
    });

    it('lists the largest Other ops first, capped, with the full count alongside', () => {
        const otherRows = Array.from({ length: MAX_LISTED_OTHER_OPS + 2 }, (_, index) =>
            makeRow(String(index), OperationCategories.OTHER, index + 1),
        );

        const breakdown = getOpCategoryBreakdown([makeRow('c', OperationCategories.COMPUTE, 1000), ...otherRows]);

        expect(breakdown?.otherOpCount).toBe(MAX_LISTED_OTHER_OPS + 2);
        expect(breakdown?.largestOtherOps).toHaveLength(MAX_LISTED_OTHER_OPS);
        expect(breakdown?.largestOtherOps.map((row) => row.device_time)).toEqual(
            Array.from({ length: MAX_LISTED_OTHER_OPS }, (_, index) => MAX_LISTED_OTHER_OPS + 2 - index),
        );
    });
});
