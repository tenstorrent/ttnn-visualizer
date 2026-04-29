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
    ColumnDefinition,
    ColumnKeys,
    Columns,
    PerfTableFilters,
    TypedPerfTableRow,
    comparisonKeys,
} from '../../definitions/PerfTable';
import 'styles/components/PerfReport.scss';
import { useGetNPEManifest, useOpToPerfIdFiltered, useOperationsList } from '../../hooks/useAPI';
import { formatCell, isHostOp } from '../../functions/perfFunctions';
import useSortTable, { SortingDirection } from '../../hooks/useSortTable';
import { OperationDescription } from '../../model/APIData';
import ROUTES from '../../definitions/Routes';
import { formatPercentage, formatSize } from '../../functions/math';
import PerfDeviceArchitecture from './PerfDeviceArchitecture';
import { hideHostOpsAtom, mergeDevicesAtom } from '../../store/app';
import LoadingSpinner from '../LoadingSpinner';
import { OpType, PATTERN_COUNT } from '../../definitions/Performance';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';

interface PerformanceTableProps {
    data: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    filters: PerfTableFilters;
    provideMatmulAdvice: boolean;
    hiliteHighDispatch: boolean;
    reportName: string | null;
    showHashColumn: boolean;
}

const OP_ID_INSERTION_POINT = 1;
const HIGH_DISPATCH_INSERTION_POINT = 5;
const CACHE_HIT_INSERTION_POINT = 15;

const PerformanceTable: FC<PerformanceTableProps> = ({
    data,
    comparisonData,
    filters,
    provideMatmulAdvice,
    hiliteHighDispatch,
    reportName,
    showHashColumn,
}) => {
    const hideHostOps = useAtomValue(hideHostOpsAtom);
    const mergeDevices = useAtomValue(mergeDevicesAtom);

    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useSortTable(null);
    const opIdsMap = useOpToPerfIdFiltered();
    const { data: operationsList } = useOperationsList();
    const { data: npeManifest, error: npeManifestError } = useGetNPEManifest();
    const navigate = useNavigate();

    const tableFields = useMemo<TypedPerfTableRow[]>(() => {
        if (!data) {
            return [];
        }

        // Still some awkward casting here
        return [...sortTableFields(data as [])];
    }, [data, sortTableFields]);

    const comparisonDataTableFields = useMemo<TypedPerfTableRow[][]>(
        () =>
            comparisonData?.map((dataset) => {
                const parsedData = dataset;

                // Still some awkward casting here
                return [...sortTableFields(parsedData as [])];
            }) || [],
        [comparisonData, sortTableFields],
    );

    const visibleColumns = [
        ...Columns.slice(0, OP_ID_INSERTION_POINT),
        ...(opIdsMap.length > 0 ? [{ name: 'OP', key: ColumnKeys.OP, sortable: true }] : []),
        ...Columns.slice(OP_ID_INSERTION_POINT, HIGH_DISPATCH_INSERTION_POINT),
        ...(hiliteHighDispatch ? [{ name: 'Slow', key: ColumnKeys.HighDispatch }] : []),
        ...Columns.slice(HIGH_DISPATCH_INSERTION_POINT, CACHE_HIT_INSERTION_POINT),
        ...(showHashColumn ? [{ name: 'Hash', key: ColumnKeys.Hash }] : []),
        ...Columns.slice(CACHE_HIT_INSERTION_POINT),
        ...(npeManifest && npeManifest.length > 0 ? [{ name: 'NPE', key: ColumnKeys.GlobalCallCount }] : []),
    ];

    const cellFormattingProxy = (
        row: TypedPerfTableRow,
        column: ColumnDefinition,
        operations?: OperationDescription[],
        highlight?: string | null,
    ) => {
        const { key } = column;

        if (key === ColumnKeys.GlobalCallCount) {
            // TODO: this is an inefficient way of doing things but its also temporary. will update next iteration
            const value = parseInt(String(row[key]), 10) || -1; // apparently npe is using 0 as a default value as opposed to no value.
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
                                variant={ButtonVariant.MINIMAL}
                                className='graph-button'
                            />
                        </Tooltip>
                    )
                );
            }

            return null;
        }

        return formatCell(row, column, operations, highlight);
    };

    if (!data) {
        return <LoadingSpinner />;
    }

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
                reportName={reportName}
            />

            {mergeDevices && <PerfMultiDeviceNotice />}

            {data?.length > 0 ? (
                <table className='perf-table monospace'>
                    <thead className='table-header'>
                        <tr>
                            {visibleColumns.map((h) => {
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
                                                <span className='header-label'>{h.name}</span>

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
                                            <span className='header-label no-button'>{h.name}</span>
                                        )}

                                        {/* TODO: May want this in the near future */}
                                        {/* {h?.filterable && (
                                                <div className='column-filter'>
                                                    <InputGroup
                                                        asyncControl
                                                        size={Size.SMALL}
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
                                        'missing-data': row.raw_op_code.includes('MISSING'),
                                        'signpost-op': row.op_type === OpType.SIGNPOST,
                                    })}
                                >
                                    {visibleColumns.map((h) => (
                                        <td
                                            key={h.key}
                                            className={classNames('cell', {
                                                'align-right': h.key === ColumnKeys.MathFidelity,
                                                'break-word': h.key === ColumnKeys.OpCode,
                                            })}
                                        >
                                            {cellFormattingProxy(row, h, operationsList, filters?.[h.key])}
                                        </td>
                                    ))}
                                </tr>

                                {comparisonDataTableFields?.length > 0 &&
                                    comparisonDataTableFields.map((dataset, index) => (
                                        <tr
                                            key={`comparison-${i}-${index}`}
                                            className={classNames(
                                                {
                                                    'missing-data': dataset[i]?.raw_op_code?.includes('MISSING'),
                                                    'signpost-op': dataset[i]?.op_type === OpType.SIGNPOST,
                                                },
                                                'comparison-row',
                                                `pattern-${index >= PATTERN_COUNT ? index - PATTERN_COUNT : index}`,
                                            )}
                                        >
                                            {visibleColumns.map((h) => (
                                                <td
                                                    key={h.key}
                                                    className={classNames('cell', {
                                                        'align-right': h.key === ColumnKeys.MathFidelity,
                                                        'break-word': h.key === ColumnKeys.OpCode,
                                                    })}
                                                >
                                                    {comparisonKeys.includes(h.key) &&
                                                        dataset[i] &&
                                                        formatCell(dataset[i], h, operationsList, filters?.[h.key])}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                {provideMatmulAdvice && row.op_code.includes('Matmul') && (
                                    <tr>
                                        <td
                                            colSpan={visibleColumns.length}
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
                            {visibleColumns.length > 0 &&
                                data?.length > 0 &&
                                visibleColumns
                                    .filter((header) => header?.footerSpan !== 0)
                                    .map((header) => (
                                        <td
                                            key={header.key}
                                            className={classNames({
                                                'pre-wrap': header.key === ColumnKeys.OpCode,
                                            })}
                                            colSpan={header.footerSpan ?? undefined}
                                        >
                                            {getTotalsForFooter(header, data, hideHostOps)}
                                        </td>
                                    ))}
                        </tr>
                    </tfoot>
                </table>
            ) : (
                <p>
                    <em>No data to display</em>
                </p>
            )}
        </>
    );
};

const getTotalsForFooter = (column: ColumnDefinition, data: TypedPerfTableRow[], hideHostOps: boolean): string => {
    if (column.key === ColumnKeys.TotalPercent) {
        return `100%`;
    }

    if (column.key === ColumnKeys.DeviceTime) {
        return `${formatSize(
            data?.reduce((acc, curr) => acc + (curr.device_time || 0), 0),
            2,
        )} µs`;
    }

    if (column.key === ColumnKeys.OpCode) {
        const hostOpsCount = data.filter((row) => isHostOp(row.bound)).length;
        const deviceOpsCount = data.length - hostOpsCount;

        return hideHostOps
            ? `${deviceOpsCount} device ops`
            : `${data.length} ops\n(${deviceOpsCount} device ops + ${hostOpsCount} host ops)`;
    }

    if (column.key === ColumnKeys.OpToOpGap) {
        return `${formatSize(
            data?.reduce((acc, curr) => acc + (curr.op_to_op_gap || 0), 0),
            2,
        )} µs`;
    }

    if (column.key === ColumnKeys.CacheHit) {
        const nonUniqueOps = data.filter((row) => !row.isFirstHashOccurrence);
        const cacheHits = nonUniqueOps.filter((row) => row.cache_hit).length;
        const cacheHitPercent = nonUniqueOps.length > 0 ? (cacheHits / nonUniqueOps.length) * 100 : 0;

        return `${formatPercentage(cacheHitPercent).toString()} expected cache hits`;
    }

    return '';
};

export default PerformanceTable;
