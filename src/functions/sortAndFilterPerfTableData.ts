// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
    FilterableColumnKeys,
    TableFilter,
    TableKeys,
    TypedPerfTableRow,
    signpostRowDefaults,
} from '../definitions/PerfTable';
import { BufferType } from '../model/BufferType';
import { Signpost, isHostOp } from './perfFunctions';

const SIGNPOST_MARKER = '(signpost)';

const isFiltersActive = (filters: TableFilter) =>
    filters ? Object.values(filters).some((filter) => filter.length > 0) : false;

const getCellText = (buffer: TypedPerfTableRow, key: TableKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

const sortAndFilterPerfTableData = (
    data: TypedPerfTableRow[],
    filters: TableFilter,
    rawOpCodeFilter: string[],
    mathFilter: string[],
    bufferTypeFilter: (BufferType | null)[],
    hideHostOps: boolean,
    filterBySignpost: Signpost | null,
): TypedPerfTableRow[] => {
    if (data?.length === 0) {
        return data;
    }

    let filteredRows = data || [];

    if (filterBySignpost) {
        filteredRows = [
            {
                ...signpostRowDefaults,
                id: filterBySignpost.id,
                // TODO: Figure out a better logic for this mismatch between tt-perf-report and visualiser
                op_code: `${filterBySignpost.op_code} ${!filterBySignpost.op_code.includes(SIGNPOST_MARKER) ? SIGNPOST_MARKER : ''}`,
                raw_op_code: filterBySignpost.op_code,
            },
            ...filteredRows,
        ];
    }

    if (hideHostOps) {
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

    if (bufferTypeFilter?.length > 0) {
        filteredRows = filteredRows.filter(
            (row) => row?.buffer_type !== null && bufferTypeFilter.includes(row.buffer_type),
        );
    }

    return filteredRows;
};

export default sortAndFilterPerfTableData;
