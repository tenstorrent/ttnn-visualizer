// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ColumnKeys } from '../src/definitions/PerfTable';
import { OpType } from '../src/definitions/Performance';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { calcHighDispatchOps, formatCell } from '../src/functions/perfFunctions';
import { getEligiblePerfColumns } from '../src/functions/perfTableColumns';

const makeRow = (overrides: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        raw_op_code: 'SomeDeviceOp',
        op_code: 'SomeDeviceOp',
        device_time: 10,
        op_to_op_gap: 1,
        high_dispatch: false,
        isFirstHashOccurrence: true,
        ...overrides,
    }) as TypedPerfTableRow;

const HIGH_DISPATCH_COLUMN = { name: 'High dispatch', key: ColumnKeys.HighDispatch };

const hasWarningIcon = (row: TypedPerfTableRow) => {
    const cell = formatCell(row, HIGH_DISPATCH_COLUMN);

    return typeof cell !== 'string' && render(<>{cell}</>).container.querySelector('.bp6-icon, svg') !== null;
};

afterEach(cleanup);

describe('High dispatch column', () => {
    it('is labelled so it cannot be mistaken for the SLOW bound', () => {
        const column = getEligiblePerfColumns({
            hasOpIds: false,
            hasL1PressureData: false,
            hiliteHighDispatch: true,
            hasNpe: false,
            hasSubDeviceIds: false,
            hasMultipleAvailableCoreBudgets: false,
        }).find((eligible) => eligible.key === ColumnKeys.HighDispatch);

        expect(column?.name).toBe('High dispatch');
    });

    it('flags a short op behind a long op-to-op gap', () => {
        expect(hasWarningIcon(makeRow({ device_time: 2, op_to_op_gap: 20, high_dispatch: true }))).toBe(true);
    });

    // Regression: the column used to compare device time against the dispatch threshold.
    it('does not flag a long-running op with a short op-to-op gap', () => {
        expect(hasWarningIcon(makeRow({ device_time: 500, op_to_op_gap: 1, high_dispatch: false }))).toBe(false);
    });
});

describe('calcHighDispatchOps', () => {
    it('totals the overhead of exactly the rows the column flags', () => {
        const rows = [
            makeRow({ device_time: 500, op_to_op_gap: 1, high_dispatch: false }),
            makeRow({ device_time: 2, op_to_op_gap: 16.5, high_dispatch: true }),
        ];

        const { container } = render(<>{calcHighDispatchOps(rows)}</>);

        // 16.5 - 6.5 = 10 µs saved.
        expect(container.textContent).toContain('could save 10 µs');
    });

    it('renders nothing when no row is flagged', () => {
        expect(calcHighDispatchOps([makeRow({ device_time: 500, high_dispatch: false })])).toBeNull();
    });
});
