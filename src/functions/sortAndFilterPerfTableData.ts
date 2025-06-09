// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PerfTableRow, TableFilter, TableKeys } from '../definitions/PerfTable';

export interface TypedPerfTableRow
    extends Omit<
        PerfTableRow,
        | 'id'
        | 'total_percent'
        | 'device_time'
        | 'op_to_op_gap'
        | 'cores'
        | 'dram'
        | 'dram_percent'
        | 'flops'
        | 'flops_percent'
    > {
    id: number;
    total_percent: number;
    device_time: number;
    op_to_op_gap: number | null;
    cores: number;
    dram: number | null;
    dram_percent: number | null;
    flops: number | null;
    flops_percent: number | null;
}

const areFiltersActive = (filters: Record<TableKeys, string> | null) =>
    filters ? Object.values(filters).some((filter) => filter.length > 0) : false;

const getCellText = (buffer: TypedPerfTableRow, key: TableKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

const sortAndFilterPerfTableData = (
    data: TypedPerfTableRow[],
    filters: TableFilter,
    filterableColumnKeys: TableKeys[],
    activeFilters: (string | number)[],
): TypedPerfTableRow[] => {
    let filteredRows = data || [];

    if (areFiltersActive(filters) && filterableColumnKeys) {
        filteredRows = filteredRows.filter((row) => {
            const isFilteredOut =
                filters &&
                Object.entries(filters)
                    .filter(([_key, filterValue]) => String(filterValue).length)
                    .some(([key, filterValue]) => {
                        const bufferValue = getCellText(row, key as TableKeys);

                        return !bufferValue.toLowerCase().includes(filterValue.toLowerCase());
                    });

            return !isFilteredOut;
        });
    }

    if (activeFilters?.length > 0) {
        filteredRows = filteredRows.filter(
            (tensor) => tensor?.math_fidelity !== null && activeFilters.includes(tensor.math_fidelity),
        );
    }

    return filteredRows;
};

export default sortAndFilterPerfTableData;
