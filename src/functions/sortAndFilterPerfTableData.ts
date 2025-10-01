// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FilterableColumnKeys, TableFilter, TableKeys, TypedPerfTableRow } from '../definitions/PerfTable';
import { MultiSelectValue } from '../hooks/useMultiSelectFilter';
import { isHostOp } from './perfFunctions';

const isFiltersActive = (filters: TableFilter) =>
    filters ? Object.values(filters).some((filter) => filter.length > 0) : false;

const getCellText = (buffer: TypedPerfTableRow, key: TableKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

const sortAndFilterPerfTableData = (
    data: TypedPerfTableRow[],
    filters: TableFilter,
    rawOpCodeFilter: MultiSelectValue[],
    mathFilter: MultiSelectValue[],
    showHostOps: boolean,
): TypedPerfTableRow[] => {
    if (data?.length === 0) {
        return data;
    }

    let filteredRows = data || [];

    if (!showHostOps) {
        filteredRows = filteredRows.filter((row) => !isHostOp(row.raw_op_code));
    }

    if (isFiltersActive(filters) && FilterableColumnKeys) {
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

    if (rawOpCodeFilter?.length > 0) {
        filteredRows = filteredRows.filter(
            (row) => row?.raw_op_code !== null && rawOpCodeFilter.includes(row.raw_op_code),
        );
    }

    if (mathFilter?.length > 0) {
        filteredRows = filteredRows.filter(
            (row) => row?.math_fidelity !== null && mathFilter.includes(row.math_fidelity),
        );
    }

    return filteredRows;
};

export default sortAndFilterPerfTableData;
