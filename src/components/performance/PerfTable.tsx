// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, Fragment, useMemo } from 'react';
import classNames from 'classnames';
import { Button, ButtonVariant, Icon, Intent, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useAtomValue } from 'jotai';
import {
    ColumnHeaders,
    ComparisonKeys,
    TableFilter,
    TableHeader,
    TableHeaders,
    TypedPerfTableRow,
    signpostRowDefaults,
} from '../../definitions/PerfTable';
import 'styles/components/PerfReport.scss';
import { useGetNPEManifest, useOpToPerfIdFiltered, useOperationsList } from '../../hooks/useAPI';
import { Signpost, formatCell, isHostOp } from '../../functions/perfFunctions';
import useSortTable, { SortingDirection } from '../../hooks/useSortTable';
import sortAndFilterPerfTableData from '../../functions/sortAndFilterPerfTableData';
import { OperationDescription } from '../../model/APIData';
import ROUTES from '../../definitions/Routes';
import { formatSize } from '../../functions/math';
import PerfDeviceArchitecture from './PerfDeviceArchitecture';
import { filterBySignpostAtom } from '../../store/app';
import LoadingSpinner from '../LoadingSpinner';

interface PerformanceTableProps {
    data: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    filters: TableFilter;
    mathFidelityFilter: (string | number)[];
    provideMatmulAdvice: boolean;
    hiliteHighDispatch: boolean;
    shouldHighlightRows: boolean;
    reportName?: string;
    signposts?: Signpost[];
}

const OP_ID_INSERTION_POINT = 1;
const HIGH_DISPATCH_INSERTION_POINT = 5;
const PATTERN_COUNT = 3; // Number of row patterns defined in PerfReport.scss

const PerformanceTable: FC<PerformanceTableProps> = ({
    data,
    comparisonData,
    filters,
    mathFidelityFilter,
    provideMatmulAdvice,
    hiliteHighDispatch,
    shouldHighlightRows,
    reportName = null,
    signposts,
}) => {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useSortTable(null);
    const opIdsMap = useOpToPerfIdFiltered();
    const { data: operations } = useOperationsList();
    const { data: npeManifest, error: npeManifestError } = useGetNPEManifest();
    const filterBySignpost = useAtomValue(filterBySignpostAtom);
    const navigate = useNavigate();

    const filterableColumnKeys = useMemo(
        () => TableHeaders.filter((column) => column.filterable).map((column) => column.key),
        [],
    );

    // TODO: Refactor so that sortAndFilterPerfTableData is not used here and PerfReport.
    // Currently it is needed because the "Showing 'x' of 'y' rows" is calculated in PerfReport but the sorting and filtering is done here.
    const tableFields = useMemo<TypedPerfTableRow[]>(() => {
        let parsedRows = sortAndFilterPerfTableData(
            data?.filter((row) => !isHostOp(row.raw_op_code)),
            filters,
            filterableColumnKeys,
            mathFidelityFilter,
        );

        // If filtering by signpost, add a fake row at the top to represent the signpost as tt-perf-report removes it from the data
        if (filterBySignpost && parsedRows.length > 0) {
            parsedRows = [
                {
                    ...signpostRowDefaults,
                    id: filterBySignpost.id,
                    op_code: filterBySignpost.op_code,
                    raw_op_code: filterBySignpost.op_code,
                },
                ...parsedRows,
            ];
        }

        // Still some awkward casting here
        return [...sortTableFields(parsedRows as [])];
    }, [data, filters, filterableColumnKeys, mathFidelityFilter, sortTableFields, filterBySignpost]);

    const comparisonDataTableFields = useMemo<TypedPerfTableRow[][]>(
        () =>
            comparisonData?.map((dataset) => {
                const parsedRows = sortAndFilterPerfTableData(
                    dataset.filter((row) => !isHostOp(row.raw_op_code)),
                    filters,
                    filterableColumnKeys,
                    mathFidelityFilter,
                );

                // Still some awkward casting here
                return [...sortTableFields(parsedRows as [])];
            }) || [],
        [comparisonData, filters, filterableColumnKeys, mathFidelityFilter, sortTableFields],
    );

    const visibleHeaders = [
        ...TableHeaders.slice(0, OP_ID_INSERTION_POINT),
        ...(opIdsMap.length > 0 ? [{ label: 'OP', key: ColumnHeaders.OP, sortable: true }] : []),
        ...TableHeaders.slice(OP_ID_INSERTION_POINT, HIGH_DISPATCH_INSERTION_POINT),
        ...(hiliteHighDispatch ? [{ label: 'Slow', key: ColumnHeaders.high_dispatch }] : []),
        ...TableHeaders.slice(HIGH_DISPATCH_INSERTION_POINT),
        ...(npeManifest && npeManifest.length > 0 ? [{ label: 'NPE', key: ColumnHeaders.global_call_count }] : []),
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
            // TODO: this is an inefficient way of doing things but its also temporary. will update next iteration
            const value = parseInt(String(row[key]), 10) || 0;
            const manifestRecord = npeManifest?.find((el) => {
                return el.global_call_count === value;
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
        <>
            {npeManifestError && (
                <div className='error-message'>
                    <Icon
                        icon={IconNames.ERROR}
                        size={20}
                        intent={Intent.WARNING}
                    />
                    <p>Invalid NPE manifest: {npeManifestError.message}</p>
                </div>
            )}

            <PerfDeviceArchitecture
                data={data}
                reportName={reportName || ''}
            />

            {/* eslint-disable-next-line no-nested-ternary */}
            {data?.length > 0 ? (
                <table className='perf-table monospace'>
                    <thead className='table-header'>
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
                                                                ? IconNames.CARET_UP
                                                                : IconNames.CARET_DOWN
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
                                        'signpost-op': signposts?.map((sp) => sp.op_code).includes(row.raw_op_code),
                                    })}
                                >
                                    {visibleHeaders.map((h) => (
                                        <td
                                            key={h.key}
                                            className={classNames('cell', {
                                                'align-right': h.key === ColumnHeaders.math_fidelity,
                                                'break-word': h.key === ColumnHeaders.op_code,
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
                                                        shouldHighlightRows &&
                                                        dataset[i]?.raw_op_code.includes('MISSING'),
                                                },
                                                'comparison-row',
                                                `pattern-${index >= PATTERN_COUNT ? index - PATTERN_COUNT : index}`,
                                            )}
                                        >
                                            {visibleHeaders.map((h) => (
                                                <td
                                                    key={h.key}
                                                    className={classNames('cell', {
                                                        'align-right': h.key === ColumnHeaders.math_fidelity,
                                                        'break-word': h.key === ColumnHeaders.op_code,
                                                    })}
                                                >
                                                    {ComparisonKeys.includes(h.key) &&
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

                    <tfoot className='table-footer'>
                        <tr>
                            {visibleHeaders.length > 0 &&
                                data?.length > 0 &&
                                visibleHeaders.map((header) => (
                                    <td
                                        key={header.key}
                                        className={classNames({
                                            'no-wrap':
                                                header.key === ColumnHeaders.op_code ||
                                                header.key === ColumnHeaders.op_to_op_gap,
                                        })}
                                    >
                                        {getTotalsForHeader(header, data)}
                                    </td>
                                ))}
                        </tr>
                    </tfoot>
                </table>
            ) : filterBySignpost ? (
                <p>No data to display from this signpost.</p>
            ) : (
                <LoadingSpinner />
            )}
        </>
    );
};

const getTotalsForHeader = (header: TableHeader, data: TypedPerfTableRow[]): string => {
    if (header.key === ColumnHeaders.total_percent) {
        return `100 %`;
    }

    if (header.key === ColumnHeaders.device_time) {
        return `${formatSize(
            data?.reduce((acc, curr) => acc + (curr.device_time || 0), 0),
            2,
        )} µs`;
    }

    if (header.key === ColumnHeaders.op_code) {
        const hostOpsCount = data.filter((row) => isHostOp(row.raw_op_code)).length;
        const deviceOpsCount = data.length - hostOpsCount;

        return `${deviceOpsCount} device ops, ${hostOpsCount} host ops`;
    }

    if (header.key === ColumnHeaders.op_to_op_gap) {
        return `${formatSize(
            data?.reduce((acc, curr) => acc + (curr.op_to_op_gap || 0), 0),
            2,
        )} µs`;
    }

    return '';
};

export default PerformanceTable;
