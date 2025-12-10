// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, Fragment, useMemo } from 'react';
import classNames from 'classnames';
import { Button, ButtonVariant, Icon, Intent, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import {
    StackedColumnHeaders,
    StackedTableColumn,
    TypedStackedPerfRow,
    stackedTableColumns,
} from '../../definitions/StackedPerfTable';
import 'styles/components/PerfReport.scss';
import useSortTable, { SortingDirection } from '../../hooks/useSortTable';
import { useGetNPEManifest } from '../../hooks/useAPI';
import { formatStackedCell } from '../../functions/stackedPerfFunctions';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import { formatSize } from '../../functions/math';
import PerfDeviceArchitecture from './PerfDeviceArchitecture';
import LoadingSpinner from '../LoadingSpinner';
import { PATTERN_COUNT } from '../../definitions/Performance';

interface StackedPerformanceTableProps {
    data: TypedPerfTableRow[];
    stackedData: TypedStackedPerfRow[];
    stackedComparisonData: TypedStackedPerfRow[][];
    filters: Record<string, string> | null;
    reportName: string | null;
}

const StackedPerformanceTable: FC<StackedPerformanceTableProps> = ({
    data,
    stackedData,
    stackedComparisonData,
    filters,
    reportName,
}) => {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useSortTable(null);
    const { error: npeManifestError } = useGetNPEManifest();

    const tableFields = useMemo<TypedStackedPerfRow[]>(() => {
        return [...sortTableFields(stackedData as [])];
    }, [stackedData, sortTableFields]);

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

            {stackedData && stackedData?.length > 0 ? (
                <table className='perf-table monospace'>
                    <thead className='table-header'>
                        <tr>
                            {stackedTableColumns.map((column) => {
                                const targetSortDirection =
                                    // eslint-disable-next-line no-nested-ternary
                                    sortingColumn === column.key
                                        ? sortDirection === SortingDirection.ASC
                                            ? SortingDirection.DESC
                                            : SortingDirection.ASC
                                        : sortDirection;

                                return (
                                    <th
                                        key={column.key}
                                        className='cell-header'
                                    >
                                        {column.sortable ? (
                                            <Button
                                                onClick={() => changeSorting(column.key)(targetSortDirection)}
                                                variant={ButtonVariant.MINIMAL}
                                                size={Size.SMALL}
                                            >
                                                <span className='header-label'>{column.label}</span>
                                                {sortingColumn === column.key ? (
                                                    <Icon
                                                        className={classNames(
                                                            {
                                                                'is-active': sortingColumn === column.key,
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
                                            <span className='header-label no-button'>{column.label}</span>
                                        )}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    <tbody>
                        {tableFields?.map((row, i) => (
                            <Fragment key={`row-${i}`}>
                                <tr>
                                    {stackedTableColumns.map((column: StackedTableColumn) => (
                                        <td
                                            key={column.key}
                                            className={classNames('cell')}
                                        >
                                            {formatStackedCell(row, column, filters?.[column.key])}
                                        </td>
                                    ))}
                                </tr>

                                {stackedComparisonData.map((comparisonDataset, datasetIndex) => {
                                    const matchingRow = comparisonDataset.find(
                                        (stackedRow) => stackedRow.op_code === row.op_code,
                                    );

                                    return (
                                        <tr
                                            key={`comparison-${i}-${datasetIndex}`}
                                            className={classNames(
                                                'comparison-row',
                                                `pattern-${datasetIndex >= PATTERN_COUNT ? datasetIndex - PATTERN_COUNT : datasetIndex}`,
                                            )}
                                        >
                                            {stackedTableColumns.map((column: StackedTableColumn) => (
                                                <td
                                                    key={`comparison-${column.key}`}
                                                    className='cell'
                                                >
                                                    {matchingRow
                                                        ? formatStackedCell(matchingRow, column, filters?.[column.key])
                                                        : ''}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </Fragment>
                        ))}
                    </tbody>

                    <tfoot className='table-footer'>
                        <tr>
                            {stackedData &&
                                stackedData?.length > 0 &&
                                stackedTableColumns.map((column) => (
                                    <td
                                        key={`footer-${column.key}`}
                                        className={classNames({
                                            'no-wrap': column.key === StackedColumnHeaders.OpCode,
                                        })}
                                    >
                                        {getTotalsForFooter(column, stackedData)}
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

const getTotalsForFooter = (column: StackedTableColumn, data: TypedStackedPerfRow[]): string => {
    if (column.key === StackedColumnHeaders.Percent) {
        return `100 %`;
    }

    if (column.key === StackedColumnHeaders.DeviceTimeSumUs) {
        return `${formatSize(
            data?.reduce((acc, curr) => acc + (curr.device_time_sum_us || 0), 0),
            2,
        )} µs`;
    }

    if (column.key === StackedColumnHeaders.OpCode) {
        return `${data.length} op types`;
    }

    if (column.key === StackedColumnHeaders.OpsCount) {
        return `${data?.reduce((acc, curr) => acc + (curr.ops_count || 0), 0)}`;
    }

    return '';
};

export default StackedPerformanceTable;
