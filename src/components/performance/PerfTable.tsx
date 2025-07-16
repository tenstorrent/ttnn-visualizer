// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, Fragment, useMemo } from 'react';
import classNames from 'classnames';
import { Button, ButtonVariant, Icon, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { TableHeader, TableKeys } from '../../definitions/PerfTable';
import 'styles/components/PerfReport.scss';
import { useGetNPEManifest, useOpToPerfIdFiltered, useOperationsList } from '../../hooks/useAPI';
import { formatCell } from '../../functions/perfFunctions';
import useSortTable, { SortingDirection } from '../../hooks/useSortTable';
import sortAndFilterPerfTableData, { TypedPerfTableRow } from '../../functions/sortAndFilterPerfTableData';
import { OperationDescription } from '../../model/APIData';
import ROUTES from '../../definitions/Routes';

interface PerformanceTableProps {
    data: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    filters: Record<TableKeys, string> | null;
    mathFidelityFilter: (string | number)[];
    provideMatmulAdvice: boolean;
    hiliteHighDispatch: boolean;
    shouldHighlightRows: boolean;
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
    GLOBAL_CALL_COUNT = 'global_call_count',
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
    COLUMN_HEADERS.GLOBAL_CALL_COUNT,
];

const OP_ID_INSERTION_POINT = 1;
const HIGH_DISPATCH_INSERTION_POINT = 5;

const PerformanceTable: FC<PerformanceTableProps> = ({
    data,
    comparisonData,
    filters,
    mathFidelityFilter,
    provideMatmulAdvice,
    hiliteHighDispatch,
    shouldHighlightRows,
}) => {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useSortTable(null);
    const opIdsMap = useOpToPerfIdFiltered();
    const { data: operations } = useOperationsList();
    const { data: npeManifest } = useGetNPEManifest();
    const navigate = useNavigate();

    const filterableColumnKeys = useMemo(
        () => TABLE_HEADERS.filter((column) => column.filterable).map((column) => column.key),
        [],
    );

    // TODO: Refactor so that sortAndFilterPerfTableData is not used here and PerfReport.
    // Currently it is needed because the "Showing 'x' of 'y' rows" is calculated in PerfReport but the sorting and filtering is done here.
    const tableFields: TypedPerfTableRow[] = useMemo(() => {
        const parsedRows = sortAndFilterPerfTableData(data, filters, filterableColumnKeys, mathFidelityFilter);

        return sortTableFields(parsedRows);
    }, [data, filters, filterableColumnKeys, mathFidelityFilter, sortTableFields]);

    const comparisonDataTableFields = useMemo(() => {
        return (
            comparisonData?.map((dataset) => {
                const parsedRows = sortAndFilterPerfTableData(
                    dataset,
                    filters,
                    filterableColumnKeys,
                    mathFidelityFilter,
                );

                return sortTableFields(parsedRows);
            }) || []
        );
    }, [comparisonData, filters, filterableColumnKeys, mathFidelityFilter, sortTableFields]);

    const visibleHeaders = [
        ...TABLE_HEADERS.slice(0, OP_ID_INSERTION_POINT),
        ...(opIdsMap.length > 0 ? [{ label: 'OP', key: COLUMN_HEADERS.OP, sortable: true }] : []),
        ...TABLE_HEADERS.slice(OP_ID_INSERTION_POINT, HIGH_DISPATCH_INSERTION_POINT),
        ...(hiliteHighDispatch ? [{ label: 'Slow', key: COLUMN_HEADERS.HIGH_DISPATCH }] : []),
        ...TABLE_HEADERS.slice(HIGH_DISPATCH_INSERTION_POINT),
        ...(npeManifest && npeManifest.length > 0 ? [{ label: 'NPE', key: COLUMN_HEADERS.GLOBAL_CALL_COUNT }] : []),
    ] as TableHeader[];

    const cellFormattingProxy = (
        row: TypedPerfTableRow,
        header: TableHeader,
        // eslint-disable-next-line @typescript-eslint/no-shadow
        operations?: OperationDescription[],
        highlight?: string | null,
    ) => {
        const { key } = header;

        if (key === 'global_call_count') {
            // TODO: this is an imefficient way of doing things but its also temporary. will update next iteration
            const value = parseInt(String(row[key]), 10) || 0;
            const manifestRecord = npeManifest?.find((el) => {
                return el.id === value;
            });

            if (manifestRecord) {
                return (
                    npeManifest &&
                    npeManifest.length > 0 && (
                        <Tooltip content={`Launch NPE timeline for ${row.raw_op_code}`}>
                            <Button
                                icon={IconNames.Random}
                                onClick={() => navigate(`${ROUTES.NPE}/${manifestRecord.file}`)}
                                variant='minimal'
                                className='graph-button'
                            />
                        </Tooltip>
                    )
                );
            }
            return null;
        }
        return formatCell(row, header, operations, highlight);
    };

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
                                'missing-data': shouldHighlightRows && row.raw_op_code.includes('MISSING'),
                            })}
                        >
                            {visibleHeaders.map((h) => (
                                <td
                                    key={h.key}
                                    className={classNames('cell', {
                                        'align-right': h.key === COLUMN_HEADERS.math_fidelity,
                                    })}
                                >
                                    {cellFormattingProxy(row, h, operations, filters?.[h.key])}
                                </td>
                            ))}
                        </tr>

                        {comparisonDataTableFields?.length > 0 &&
                            comparisonDataTableFields.map((dataset, index) => (
                                <tr
                                    key={`comparison-${i}-${index}`}
                                    className={classNames(
                                        {
                                            'missing-data':
                                                shouldHighlightRows && dataset[i]?.raw_op_code.includes('MISSING'),
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
                                                dataset[i] &&
                                                formatCell(dataset[i], h, operations, filters?.[h.key])}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        {provideMatmulAdvice && row.op_code.includes('Matmul') && (
                            <tr>
                                <td
                                    colSpan={visibleHeaders.length}
                                    className='cell advice'
                                >
                                    <ul>
                                        {row?.advice.map((advice, j) => (
                                            <li key={`advice-${j}`}>{advice}</li>
                                        ))}
                                    </ul>
                                </td>
                            </tr>
                        )}
                    </Fragment>
                ))}
            </tbody>
        </table>
    );
};

export default PerformanceTable;
