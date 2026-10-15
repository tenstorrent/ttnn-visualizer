// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ColumnKeys, PerfTableFilters } from '../definitions/PerfTable';
import { TypedPerfTableRow, signpostRowDefaults } from '../model/PerfTable';
import { Signpost } from '../model/Signpost';

const SIGNPOST_MARKER = '(signpost)';

const isFiltersActive = (filters?: PerfTableFilters) =>
    filters ? Object.values(filters).some((filter) => filter.length > 0) : false;

const getCellText = (buffer: TypedPerfTableRow, key: ColumnKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

interface SortAndFilterPerfTableDataOptions {
    filters?: PerfTableFilters;
    filterBySignpost?: (Signpost | null)[];
}

const sortAndFilterPerfTableData = (
    data: TypedPerfTableRow[] = [],
    { filters, filterBySignpost = [] }: SortAndFilterPerfTableDataOptions = {},
): TypedPerfTableRow[] => {
    if (data.length === 0) {
        return data;
    }

    let filteredRows = data || [];

    if (filterBySignpost[0]) {
        filteredRows = [
            {
                ...signpostRowDefaults,
                id: filterBySignpost[0].id,
                // TODO: Figure out a better logic for this mismatch between tt-perf-report and visualiser
                op_code: `${filterBySignpost[0].op_code} ${!filterBySignpost[0].op_code.includes(SIGNPOST_MARKER) ? SIGNPOST_MARKER : ''}`,
                raw_op_code: filterBySignpost[0].op_code,
            },
            ...filteredRows,
        ];
    }

    if (filterBySignpost[1]) {
        filteredRows = [
            ...filteredRows,
            {
                ...signpostRowDefaults,
                id: filterBySignpost[1].id,
                // TODO: Figure out a better logic for this mismatch between tt-perf-report and visualiser
                op_code: `${filterBySignpost[1].op_code} ${!filterBySignpost[1].op_code.includes(SIGNPOST_MARKER) ? SIGNPOST_MARKER : ''}`,
                raw_op_code: filterBySignpost[1].op_code,
            },
        ];
    }

    if (isFiltersActive(filters)) {
        filteredRows = filteredRows.filter((row) => {
            const isFilteredOut =
                filters &&
                Object.entries(filters)
                    .filter(([_key, filterValue]) => String(filterValue).length)
                    .some(([key, filterValue]) => {
                        const bufferValue = getCellText(row, key as ColumnKeys);

                        return !bufferValue.toLowerCase().includes(filterValue.toLowerCase());
                    });

            return !isFilteredOut;
        });
    }

    return filteredRows;
};

export default sortAndFilterPerfTableData;
