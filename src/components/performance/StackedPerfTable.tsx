// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Fragment, useMemo } from 'react';
import classNames from 'classnames';
import { Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai';
import {
    StackedColumnKeys,
    StackedTableColumn,
    TypedStackedPerfRow,
    stackedTableColumns,
} from '../../definitions/StackedPerfTable';
import 'styles/components/PerfReport.scss';
import useSortTable from '../../hooks/useSortTable';
import { useGetNPEManifest } from '../../hooks/useAPI';
import { formatStackedCell } from '../../functions/stackedPerfFunctions';
import { formatPercentage, formatSize } from '../../functions/math';
import PerfDeviceArchitecture from './PerfDeviceArchitecture';
import PerfTableFrame from './PerfTableFrame';
import PerfTableSkeleton from './PerfTableSkeleton';
import SortableHeaderLabel from './SortableHeaderLabel';
import { PATTERN_COUNT } from '../../definitions/Performance';
import { mergeDevicesAtom } from '../../store/app';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';

// The footer's total is formatted as the Total % cells above it are.
const PERCENT_DECIMALS = stackedTableColumns.find((column) => column.key === StackedColumnKeys.Percent)?.decimals;

interface StackedPerformanceTableProps {
    stackedData: TypedStackedPerfRow[];
    stackedComparisonData: TypedStackedPerfRow[][];
    filters: Record<string, string> | null;
    /** On-disk folder of the report these rows came from; addresses the device-meta fetch. */
    reportFolderName: string | null;
    maxCores: number;
    isLoading?: boolean;
}

const StackedPerformanceTable = ({
    stackedData,
    stackedComparisonData,
    filters,
    reportFolderName,
    maxCores,
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
            <PerfTableFrame scrollResetKey={tableFields}>
                <thead className='table-header'>
                    <tr>
                        {computedTableColumns.map((column) => (
                            <th
                                key={column.key}
                                className='cell-header'
                            >
                                <SortableHeaderLabel
                                    columnKey={column.key}
                                    label={column.label}
                                    sortable={column.sortable}
                                    sortingColumn={sortingColumn}
                                    sortDirection={sortDirection}
                                    onSort={changeSorting}
                                />
                            </th>
                        ))}
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
            </PerfTableFrame>
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
                reportFolderName={reportFolderName}
                maxCores={maxCores}
            />

            {mergeDevices && <PerfMultiDeviceNotice />}

            {renderTable()}
        </>
    );
};

const computeFooterTotals = (data: TypedStackedPerfRow[]): Partial<Record<StackedColumnKeys, string>> => {
    const rows = data ?? [];
    let percentSum = 0;
    let deviceTimeSum = 0;
    let opsCountSum = 0;

    for (const row of rows) {
        percentSum += row[StackedColumnKeys.Percent] || 0;
        deviceTimeSum += row[StackedColumnKeys.DeviceTimeSumUs] || 0;
        opsCountSum += row[StackedColumnKeys.OpsCount] || 0;
    }

    return {
        // Each row's percentage is a share of the whole report, so under a filter the visible rows
        // sum to less than 100; summing them keeps the footer about the rows it sits under.
        [StackedColumnKeys.Percent]: formatPercentage(percentSum, PERCENT_DECIMALS),
        [StackedColumnKeys.DeviceTimeSumUs]: `${formatSize(deviceTimeSum, 2)} µs`,
        [StackedColumnKeys.OpCode]: `${rows.length} op types`,
        [StackedColumnKeys.OpsCount]: `${opsCountSum}`,
    };
};

export default StackedPerformanceTable;
