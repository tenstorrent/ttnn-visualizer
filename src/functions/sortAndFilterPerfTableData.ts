// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { TableFilter, TableKeys, TypedPerfTableRow } from '../definitions/PerfTable';

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
