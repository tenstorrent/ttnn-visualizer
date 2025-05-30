// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, Fragment, useMemo } from 'react';
import classNames from 'classnames';
import { Button, ButtonVariant, Icon, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { PerfTableRow, TableHeader, TableKeys } from '../../definitions/PerfTable';
import 'styles/components/PerfReport.scss';
import { useOperationsList, useOptoPerfIdFiltered } from '../../hooks/useAPI';
import { formatCell } from '../../functions/perfFunctions';
import useSortTable, { SortingDirection } from '../../hooks/useSortTable';
import useTableFilter from '../../hooks/useTableFilter';

interface PerformanceTableProps {
    data: PerfTableRow[];
    comparisonData?: PerfTableRow[];
    filters: Record<TableKeys, string> | null;
    provideMatmulAdvice: boolean;
    hiliteHighDispatch: boolean;
    matches?: PerfTableRow[];
    highlightRows?: boolean;
    normaliseData?: boolean;
}

interface TypedPerfTableRow
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
    dram: number;
    dram_percent: number;
    flops: number;
    flops_percent: number;
}

enum COLUMN_HEADERS {
    id = 'id',
    total_percent = 'total_percent',
    bound = 'bound',
    op_code = 'op_code',
    device_time = 'device_time',
    op_to_op_gap = 'op_to_op_gap',
    cores = 'cores',
    dram = 'dram',
    dram_percent = 'dram_percent',
    flops = 'flops',
    flops_percent = 'flops_percent',
    math_fidelity = 'math_fidelity',
    OP = 'op',
    HIGH_DISPATCH = 'high_dispatch',
}

const TABLE_HEADERS: TableHeader[] = [
    { label: 'ID', key: COLUMN_HEADERS.id, sortable: true },
    { label: 'Total %', key: COLUMN_HEADERS.total_percent, unit: '%', decimals: 1, sortable: true },
    { label: 'Bound', key: COLUMN_HEADERS.bound, colour: 'yellow' },
    { label: 'OP Code', key: COLUMN_HEADERS.op_code, colour: 'blue', sortable: true, filterable: true },
    { label: 'Device Time', key: COLUMN_HEADERS.device_time, unit: 'µs', decimals: 0, sortable: true },
    { label: 'Op-to-Op Gap', key: COLUMN_HEADERS.op_to_op_gap, colour: 'red', unit: 'µs', decimals: 0, sortable: true },
    { label: 'Cores', key: COLUMN_HEADERS.cores, colour: 'green', sortable: true },
    { label: 'DRAM', key: COLUMN_HEADERS.dram, colour: 'yellow', unit: 'GB/s', sortable: true },
    { label: 'DRAM %', key: COLUMN_HEADERS.dram_percent, colour: 'yellow', unit: '%', sortable: true },
    { label: 'FLOPs', key: COLUMN_HEADERS.flops, unit: 'TFLOPs', sortable: true },
    { label: 'FLOPs %', key: COLUMN_HEADERS.flops_percent, unit: '%', sortable: true },
    { label: 'Math Fidelity', key: COLUMN_HEADERS.math_fidelity, colour: 'cyan' },
];

const COMPARISON_KEYS: TableKeys[] = [
    COLUMN_HEADERS.op_code,
    COLUMN_HEADERS.bound,
    COLUMN_HEADERS.total_percent,
    COLUMN_HEADERS.device_time,
    COLUMN_HEADERS.op_to_op_gap,
    COLUMN_HEADERS.cores,
    COLUMN_HEADERS.dram,
    COLUMN_HEADERS.dram_percent,
    COLUMN_HEADERS.flops,
    COLUMN_HEADERS.flops_percent,
    COLUMN_HEADERS.math_fidelity,
    COLUMN_HEADERS.HIGH_DISPATCH,
];

const OP_ID_INSERTION_POINT = 1;
const HIGH_DISPATCH_INSERTION_POINT = 5;

const PerformanceTable: FC<PerformanceTableProps> = ({
    data,
    comparisonData,
    filters,
    provideMatmulAdvice,
    hiliteHighDispatch,
    matches,
    highlightRows,
    normaliseData,
}) => {
    const { activeFilters } = useTableFilter('math_fidelity', data || []);
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useSortTable(null);
    const opIdsMap = useOptoPerfIdFiltered();
    const { data: operations } = useOperationsList();

    const filterableColumnKeys = useMemo(
        () => TABLE_HEADERS.filter((column) => column.filterable).map((column) => column.key),
        [],
    );

    const tableFields: PerfTableRow[] = useMemo(() => {
        let filteredRows = data;

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

        const parsedRows = filteredRows.map((row) => ({
            ...row,
            id: row.id ? parseInt(row.id, 10) : null,
            total_percent: row.total_percent ? parseFloat(row.total_percent) : null,
            device_time: row.device_time ? parseFloat(row.device_time) : null,
            op_to_op_gap: row.op_to_op_gap ? parseFloat(row.op_to_op_gap) : null,
            cores: row.cores ? parseInt(row.cores, 10) : null,
            dram: row.dram ? parseFloat(row.dram) : null,
            dram_percent: row.dram_percent ? parseFloat(row.dram_percent) : null,
            flops: row.flops ? parseFloat(row.flops) : null,
            flops_percent: row.flops_percent ? parseFloat(row.flops_percent) : null,
        })) as TypedPerfTableRow[];

        return sortTableFields(parsedRows);
    }, [data, sortTableFields, filters, filterableColumnKeys, activeFilters]);

    const comparisonDataTableFields: PerfTableRow[] = useMemo(() => {
        let filteredRows = comparisonData || [];

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

        const parsedRows = filteredRows.map((row) => ({
            ...row,
            id: row.id ? parseInt(row.id, 10) : null,
            total_percent: row.total_percent ? parseFloat(row.total_percent) : null,
            device_time: row.device_time ? parseFloat(row.device_time) : null,
            op_to_op_gap: row.op_to_op_gap ? parseFloat(row.op_to_op_gap) : null,
            cores: row.cores ? parseInt(row.cores, 10) : null,
            dram: row.dram ? parseFloat(row.dram) : null,
            dram_percent: row.dram_percent ? parseFloat(row.dram_percent) : null,
            flops: row.flops ? parseFloat(row.flops) : null,
            flops_percent: row.flops_percent ? parseFloat(row.flops_percent) : null,
        })) as TypedPerfTableRow[];

        return sortTableFields(parsedRows);
    }, [comparisonData, sortTableFields, filters, filterableColumnKeys, activeFilters]);

    const visibleHeaders = [
        ...TABLE_HEADERS.slice(0, OP_ID_INSERTION_POINT),
        ...(opIdsMap.length > 0 ? [{ label: 'OP', key: COLUMN_HEADERS.OP, sortable: true }] : []),
        ...TABLE_HEADERS.slice(OP_ID_INSERTION_POINT, HIGH_DISPATCH_INSERTION_POINT),
        ...(hiliteHighDispatch ? [{ label: 'Slow', key: COLUMN_HEADERS.HIGH_DISPATCH }] : []),
        ...TABLE_HEADERS.slice(HIGH_DISPATCH_INSERTION_POINT),
    ] as TableHeader[];

    return (
        <table className='perf-table monospace'>
            <thead>
                <tr>
                    {visibleHeaders.map((h) => {
                        const targetSortDirection =
                            // eslint-disable-next-line no-nested-ternary
                            sortingColumn === h.key
                                ? sortDirection === SortingDirection.ASC
                                    ? SortingDirection.DESC
                                    : SortingDirection.ASC
                                : sortDirection;

                        return (
                            <th
                                key={h.key}
                                className='cell-header'
                            >
                                {h.sortable ? (
                                    <Button
                                        onClick={() => changeSorting(h.key)(targetSortDirection)}
                                        variant={ButtonVariant.MINIMAL}
                                        size={Size.SMALL}
                                    >
                                        <span className='header-label'>{h.label}</span>

                                        {sortingColumn === h.key ? (
                                            <Icon
                                                className={classNames(
                                                    {
                                                        'is-active': sortingColumn === h.key,
                                                    },
                                                    'sort-icon',
                                                )}
                                                icon={
                                                    sortDirection === SortingDirection.ASC
                                                        ? IconNames.CARET_DOWN
                                                        : IconNames.CARET_UP
                                                }
                                            />
                                        ) : (
                                            <Icon
                                                className={classNames('sort-icon')}
                                                icon={IconNames.CARET_DOWN}
                                            />
                                        )}
                                    </Button>
                                ) : (
                                    <span className='header-label no-button'>{h.label}</span>
                                )}

                                {/* TODO: May want this in the near future */}
                                {/* {h?.filterable && (
                                            <div className='column-filter'>
                                                <InputGroup
                                                    asyncControl
                                                    size='small'
                                                    onValueChange={(value) => updateColumnFilter(h.key, value)}
                                                    placeholder='Filter...'
                                                    value={filters?.[h.key]}
                                                />
                                            </div>
                                        )} */}
                            </th>
                        );
                    })}
                </tr>
            </thead>

            <tbody>
                {tableFields.map((row, i) => (
                    <Fragment key={i}>
                        <tr
                            className={classNames({
                                'missing-data': highlightRows && (row.missing || row.raw_op_code.includes('MISSING')),
                                'added-data':
                                    highlightRows &&
                                    !row.missing &&
                                    matches?.some(
                                        (match) =>
                                            parseInt(match.id, 10) === parseInt(row.id, 10) &&
                                            match.raw_op_code === row.raw_op_code,
                                    ),
                                'row-pattern': comparisonData && normaliseData,
                            })}
                        >
                            {visibleHeaders.map((h) => (
                                <td
                                    key={h.key}
                                    className={classNames('cell', {
                                        'align-right': h.key === COLUMN_HEADERS.math_fidelity,
                                    })}
                                >
                                    {formatCell(row, h, operations, filters?.[h.key])}
                                </td>
                            ))}
                        </tr>

                        {comparisonDataTableFields[i] && (
                            <tr
                                className={classNames(
                                    {
                                        'missing-data':
                                            highlightRows && (row.missing || row.raw_op_code.includes('MISSING')),
                                        'added-data':
                                            highlightRows &&
                                            !row.missing &&
                                            matches?.some(
                                                (match) =>
                                                    parseInt(match.id, 10) === parseInt(row.id, 10) &&
                                                    match.raw_op_code === row.raw_op_code,
                                            ),
                                        'row-pattern': comparisonData && normaliseData,
                                    },
                                    'comparison-row',
                                )}
                            >
                                {visibleHeaders.map((h) => (
                                    <td
                                        key={h.key}
                                        className={classNames('cell', {
                                            'align-right': h.key === COLUMN_HEADERS.math_fidelity,
                                        })}
                                    >
                                        {COMPARISON_KEYS.includes(h.key) &&
                                            comparisonDataTableFields[i] &&
                                            (h.key !== COLUMN_HEADERS.op_code ||
                                                (h.key === COLUMN_HEADERS.op_code &&
                                                    isOpCodeMatmulOrConv(row.op_code))) && (
                                                <>
                                                    {formatCell(
                                                        comparisonDataTableFields[i],
                                                        h,
                                                        operations,
                                                        filters?.[h.key],
                                                    )}
                                                </>
                                            )}
                                    </td>
                                ))}
                            </tr>
                        )}
                        {provideMatmulAdvice && row.op_code.includes('Matmul') && (
                            <tr>
                                <td
                                    colSpan={visibleHeaders.length}
                                    className='cell advice'
                                >
                                    <ul>{row?.advice.map((advice, j) => <li key={`advice-${j}`}>{advice}</li>)}</ul>
                                </td>
                            </tr>
                        )}
                    </Fragment>
                ))}
            </tbody>
        </table>
    );
};

function areFiltersActive(filters: Record<TableKeys, string> | null) {
    return filters ? Object.values(filters).some((filter) => filter.length > 0) : false;
}

const getCellText = (buffer: PerfTableRow, key: TableKeys) => {
    const textValue = buffer[key]?.toString() || '';

    return textValue;
};

const isOpCodeMatmulOrConv = (opCode: string) =>
    opCode.toLowerCase().includes('matmul') || opCode.toLowerCase().includes('conv');

export default PerformanceTable;
