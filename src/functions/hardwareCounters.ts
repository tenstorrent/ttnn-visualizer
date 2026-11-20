// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ColumnKeys, HARDWARE_COUNTER_COLUMN_KEYS } from '../definitions/PerfTable';
import {
    HARDWARE_COUNTERS_SWITCH_HINT,
    HardwareCounterMeasure,
    NO_HARDWARE_COUNTERS_HINT,
    NO_HARDWARE_COUNTER_COLUMNS_HINT,
} from '../definitions/HardwareCounters';
import { TypedPerfTableRow } from '../model/PerfTable';
import { formatPercentage, formatSize } from './math';

const PERCENT_DECIMALS = 1;
const RATIO_DECIMALS = 3;

/** The counter columns the rows carry: the backend adds a key only for a column the capture has. */
export const getHardwareCounterKeys = (rows: TypedPerfTableRow[]): ReadonlySet<ColumnKeys> => {
    const keys = new Set<ColumnKeys>();

    for (const row of rows) {
        HARDWARE_COUNTER_COLUMN_KEYS.forEach((key) => {
            if (key in row) {
                keys.add(key);
            }
        });

        if (keys.size === HARDWARE_COUNTER_COLUMN_KEYS.size) {
            break;
        }
    }

    return keys;
};

const hasHardwareCounterColumn = (row: TypedPerfTableRow): boolean => {
    for (const key of HARDWARE_COUNTER_COLUMN_KEYS) {
        if (key in row) {
            return true;
        }
    }

    return false;
};

/** Whether the rows carry any of the table's counter columns, which a capture of other groups only lacks. */
export const hasHardwareCounterColumns = (rows: TypedPerfTableRow[]): boolean => rows.some(hasHardwareCounterColumn);

/** Why the table's counter switch is off, or what it shows when on. */
export const getHardwareCountersSwitchHint = (hasCounters: boolean, hasColumns: boolean): string => {
    if (!hasCounters) {
        return NO_HARDWARE_COUNTERS_HINT;
    }

    return hasColumns ? HARDWARE_COUNTERS_SWITCH_HINT : NO_HARDWARE_COUNTER_COLUMNS_HINT;
};

export const formatHardwareCounterValue = (value: number, measure: HardwareCounterMeasure | null): string =>
    measure === HardwareCounterMeasure.RATIO
        ? formatSize(value, RATIO_DECIMALS)
        : formatPercentage(value, PERCENT_DECIMALS);
