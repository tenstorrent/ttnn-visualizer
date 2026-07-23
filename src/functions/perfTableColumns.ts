// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
    ColumnDefinition,
    ColumnKeys,
    Columns,
    L1PressureColumns,
    LOCKED_PERF_COLUMN_KEYS,
} from '../definitions/PerfTable';

const OP_ID_INSERTION_POINT = 1;
const L1_PRESSURE_INSERTION_POINT = 2;
const HIGH_DISPATCH_INSERTION_POINT = 6;

export interface EligiblePerfColumnsFlags {
    hasOpIds: boolean;
    hasL1PressureData: boolean;
    hiliteHighDispatch: boolean;
    hasNpe: boolean;
}

export function getEligiblePerfColumns(flags: EligiblePerfColumnsFlags): ColumnDefinition[] {
    return [
        ...Columns.slice(0, OP_ID_INSERTION_POINT),
        ...(flags.hasOpIds ? [{ name: 'OP', key: ColumnKeys.OP, sortable: true }] : []),
        ...Columns.slice(OP_ID_INSERTION_POINT, L1_PRESSURE_INSERTION_POINT),
        ...(flags.hasL1PressureData ? L1PressureColumns : []),
        ...Columns.slice(L1_PRESSURE_INSERTION_POINT, HIGH_DISPATCH_INSERTION_POINT),
        ...(flags.hiliteHighDispatch ? [{ name: 'Slow', key: ColumnKeys.HighDispatch }] : []),
        ...Columns.slice(HIGH_DISPATCH_INSERTION_POINT),
        ...(flags.hasNpe ? [{ name: 'NPE', key: ColumnKeys.GlobalCallCount }] : []),
    ];
}

export function getVisiblePerfColumns(
    eligibleColumns: ColumnDefinition[],
    hiddenColumnKeys: ColumnKeys[],
): ColumnDefinition[] {
    const hiddenKeys = new Set(hiddenColumnKeys);

    return eligibleColumns.filter(
        (column) => LOCKED_PERF_COLUMN_KEYS.includes(column.key) || !hiddenKeys.has(column.key),
    );
}

export function getFooterColumns(visibleColumns: ColumnDefinition[]): ColumnDefinition[] {
    const opCodeIndex = visibleColumns.findIndex((column) => column.key === ColumnKeys.OpCode);

    return visibleColumns
        .filter((column) => column.footerSpan !== 0)
        .map((column) => {
            if (column.key === ColumnKeys.OpCode && opCodeIndex >= 0) {
                const trailingSkippedCount = visibleColumns
                    .slice(opCodeIndex + 1)
                    .filter((trailingColumn) => trailingColumn.footerSpan === 0).length;

                return { ...column, footerSpan: 1 + trailingSkippedCount };
            }

            return column;
        });
}
