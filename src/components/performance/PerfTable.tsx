// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, Fragment, useMemo } from 'react';
import classNames from 'classnames';
import { Button, ButtonVariant, Icon, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { TableHeader, TableKeys } from '../../definitions/PerfTable';
import 'styles/components/PerfReport.scss';
import { useOpToPerfIdFiltered, useOperationsList } from '../../hooks/useAPI';
import { formatCell } from '../../functions/perfFunctions';
import useSortTable, { SortingDirection } from '../../hooks/useSortTable';
import useTableFilter from '../../hooks/useTableFilter';
import sortAndFilterPerfTableData, { TypedPerfTableRow } from '../../functions/sortAndFilterPerfTableData';

interface PerformanceTableProps {
    data: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[];
    filters: Record<TableKeys, string> | null;
    provideMatmulAdvice: boolean;
    hiliteHighDispatch: boolean;
    matches?: TypedPerfTableRow[];
    highlightRows?: boolean;
    normaliseData?: boolean;
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
    const opIdsMap = useOpToPerfIdFiltered();
    const { data: operations } = useOperationsList();

    const filterableColumnKeys = useMemo(
        () => TABLE_HEADERS.filter((column) => column.filterable).map((column) => column.key),
        [],
    );

    // TODO: Refactor so that sortAndFilterPerfTableData is not used here and PerfReport.
    // Currently it is needed because the "Showing 'x' of 'y' rows" is calculated in PerfReport but the sorting and filtering is done here.
    const tableFields: TypedPerfTableRow[] = useMemo(() => {
        const parsedRows = sortAndFilterPerfTableData(data, filters, filterableColumnKeys, activeFilters);

        return sortTableFields(parsedRows);
    }, [data, filters, filterableColumnKeys, activeFilters, sortTableFields]);

    const comparisonDataTableFields: TypedPerfTableRow[] = useMemo(() => {
        const dataToProcess = comparisonData || [];
        const parsedRows = sortAndFilterPerfTableData(dataToProcess, filters, filterableColumnKeys, activeFilters);

        return sortTableFields(parsedRows);
    }, [comparisonData, filters, filterableColumnKeys, activeFilters, sortTableFields]);

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
                {tableFields?.map((row, i) => (
                    <Fragment key={i}>
                        <tr
                            className={classNames({
                                'missing-data': highlightRows && (row.missing || row.raw_op_code.includes('MISSING')),
                                'added-data':
                                    highlightRows &&
                                    !row.missing &&
                                    matches?.some(
                                        (match) => match.id === row.id && match.raw_op_code === row.raw_op_code,
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
                                                (match) => match.id === row.id && match.raw_op_code === row.raw_op_code,
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

const isOpCodeMatmulOrConv = (opCode: string) =>
    opCode.toLowerCase().includes('matmul') || opCode.toLowerCase().includes('conv');

export default PerformanceTable;
