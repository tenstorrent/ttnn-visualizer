// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { StackedPerfRow, StackedTableFilter, StackedTableKeys } from '../definitions/PerfTable';

export interface TypedStackedPerfRow
    extends Omit<
        StackedPerfRow,
        'percent' | 'device_time_sum_us' | 'ops_count' | 'flops_min' | 'flops_max' | 'flops_mean' | 'flops_std'
    > {
    percent: number | null;
    device_time_sum_us: number | null;
    ops_count: number | null;
    flops_min: number | null;
    flops_max: number | null;
    flops_mean: number | null;
    flops_std: number | null;
}

const areFiltersActive = (filters: Record<StackedTableKeys, string> | null) =>
    filters ? Object.values(filters).some((filter) => filter.length > 0) : false;

const getCellText = (buffer: TypedStackedPerfRow, key: StackedTableKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

const sortAndFilterStackedPerfTableData = (
    data: TypedStackedPerfRow[],
    filters: StackedTableFilter,
    filterableColumnKeys: StackedTableKeys[],
): TypedStackedPerfRow[] => {
    if (data?.length === 0) {
        return data;
    }

    let filteredRows = data || [];

    if (areFiltersActive(filters) && filterableColumnKeys) {
        filteredRows = filteredRows.filter((row) => {
            const isFilteredOut =
                filters &&
                Object.entries(filters)
                    .filter(([_key, filterValue]) => String(filterValue).length)
                    .some(([key, filterValue]) => {
                        const bufferValue = getCellText(row, key as StackedTableKeys);

                        return !bufferValue.toLowerCase().includes(filterValue.toLowerCase());
                    });

            return !isFilteredOut;
        });
    }

    return filteredRows;
};

export default sortAndFilterStackedPerfTableData;
