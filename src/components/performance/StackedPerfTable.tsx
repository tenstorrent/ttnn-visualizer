// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Fragment, useMemo } from 'react';
import classNames from 'classnames';
import { Button, ButtonVariant, Icon, Intent, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai';
import {
    StackedColumnKeys,
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
import PerfTableSkeleton from './PerfTableSkeleton';
import { PATTERN_COUNT } from '../../definitions/Performance';
import { mergeDevicesAtom } from '../../store/app';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';

interface StackedPerformanceTableProps {
    data: TypedPerfTableRow[];
    stackedData: TypedStackedPerfRow[];
    stackedComparisonData: TypedStackedPerfRow[][];
    filters: Record<string, string> | null;
    reportName: string | null;
    isLoading?: boolean;
}

const StackedPerformanceTable = ({
    data,
    stackedData,
    stackedComparisonData,
    filters,
    reportName,
    isLoading = false,
}: StackedPerformanceTableProps) => {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useSortTable(null);
    const { error: npeManifestError } = useGetNPEManifest();
    const mergeDevices = useAtomValue(mergeDevicesAtom);

    const tableFields = useMemo<TypedStackedPerfRow[]>(() => {
        return [...sortTableFields(stackedData as [])];
    }, [stackedData, sortTableFields]);

    const computedTableColumns = useMemo<StackedTableColumn[]>(
        () =>
            mergeDevices
                ? stackedTableColumns.filter((column) => column.key !== StackedColumnKeys.Device)
                : stackedTableColumns,
        [mergeDevices],
    );

    const footerTotals = useMemo(() => computeFooterTotals(stackedData), [stackedData]);

    const renderTable = () => {
        if (isLoading) {
            return <PerfTableSkeleton headers={computedTableColumns.map((column) => column.label)} />;
        }

        if (!stackedData?.length) {
            return (
                <p>
                    <em>No data to display</em>
                </p>
            );
        }

        return (
            <table className='perf-table monospace'>
                <thead className='table-header'>
                    <tr>
                        {computedTableColumns.map((column) => {
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
                                {computedTableColumns.map((column: StackedTableColumn) => (
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
                                    (stackedRow) =>
                                        stackedRow[StackedColumnKeys.OpCode] === row[StackedColumnKeys.OpCode],
                                );

                                return (
                                    <tr
                                        key={`comparison-${i}-${datasetIndex}`}
                                        className={classNames(
                                            'comparison-row',
                                            `pattern-${datasetIndex >= PATTERN_COUNT ? datasetIndex - PATTERN_COUNT : datasetIndex}`,
                                        )}
                                    >
                                        {computedTableColumns.map((column: StackedTableColumn) => (
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
                            computedTableColumns.map((column) => (
                                <td
                                    key={`footer-${column.key}`}
                                    className={classNames({
                                        'no-wrap': column.key === StackedColumnKeys.OpCode,
                                    })}
                                >
                                    {footerTotals[column.key] ?? ''}
                                </td>
                            ))}
                    </tr>
                </tfoot>
            </table>
        );
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
                reportName={reportName}
            />

            {mergeDevices && <PerfMultiDeviceNotice />}

            {renderTable()}
        </>
    );
};

const computeFooterTotals = (data: TypedStackedPerfRow[]): Partial<Record<StackedColumnKeys, string>> => {
    const rows = data ?? [];
    let deviceTimeSum = 0;
    let opsCountSum = 0;

    for (const row of rows) {
        deviceTimeSum += row[StackedColumnKeys.DeviceTimeSumUs] || 0;
        opsCountSum += row[StackedColumnKeys.OpsCount] || 0;
    }

    return {
        [StackedColumnKeys.Percent]: '100%',
        [StackedColumnKeys.DeviceTimeSumUs]: `${formatSize(deviceTimeSum, 2)} µs`,
        [StackedColumnKeys.OpCode]: `${rows.length} op types`,
        [StackedColumnKeys.OpsCount]: `${opsCountSum}`,
    };
};

export default StackedPerformanceTable;
