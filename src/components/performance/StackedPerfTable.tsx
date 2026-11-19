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
import { formatStackedCell, sumStackedDeviceTime } from '../../functions/stackedPerfFunctions';
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
    /** Device time of every row before filtering; the footer's Total % is the visible rows' share of it. */
    totalDeviceTimeUs: number;
}

const StackedPerformanceTable = ({
    stackedData,
    stackedComparisonData,
    filters,
    reportFolderName,
    maxCores,
    isLoading = false,
    totalDeviceTimeUs,
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

    const footerTotals = useMemo(
        () => computeFooterTotals(stackedData, totalDeviceTimeUs),
        [stackedData, totalDeviceTimeUs],
    );

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

const computeFooterTotals = (
    data: TypedStackedPerfRow[],
    totalDeviceTimeUs: number,
): Partial<Record<StackedColumnKeys, string>> => {
    const rows = data ?? [];
    const deviceTimeSum = sumStackedDeviceTime(rows);
    const opsCountSum = rows.reduce((total, row) => total + (row[StackedColumnKeys.OpsCount] || 0), 0);

    return {
        // The visible rows' share of all device time (see `sumStackedDeviceTime`): 100% unfiltered,
        // less under a filter, whether or not devices are merged.
        [StackedColumnKeys.Percent]: formatPercentage(
            totalDeviceTimeUs > 0 ? (deviceTimeSum / totalDeviceTimeUs) * 100 : 0,
            PERCENT_DECIMALS,
        ),
        [StackedColumnKeys.DeviceTimeSumUs]: `${formatSize(deviceTimeSum, 2)} µs`,
        [StackedColumnKeys.OpCode]: `${rows.length} op types`,
        [StackedColumnKeys.OpsCount]: `${opsCountSum}`,
    };
};

export default StackedPerformanceTable;
