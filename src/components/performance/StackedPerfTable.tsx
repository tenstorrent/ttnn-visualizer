// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useMemo } from 'react';
import classNames from 'classnames';
import { Button, ButtonVariant, Icon, Intent, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import {
    ColumnHeaders,
    FilterableStackedColumnKeys,
    StackedTableHeader,
    TableHeaders,
    TypedStackedPerfRow,
} from '../../definitions/StackedPerfTable';
import 'styles/components/PerfReport.scss';
import useSortTable, { SortingDirection } from '../../hooks/useSortTable';
import { useDeviceLog, useGetNPEManifest } from '../../hooks/useAPI';
import LoadingSpinner from '../LoadingSpinner';
import { LoadingSpinnerSizes } from '../../definitions/LoadingSpinner';
import { DeviceArchitecture } from '../../definitions/DeviceArchitecture';
import getCoreCount from '../../functions/getCoreCount';
import sortAndFilterStackedPerfTableData from '../../functions/sortAndFilterStackedPerfTableData';
import { formatStackedCell } from '../../functions/stackedPerfFunctions';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import { formatSize } from '../../functions/math';
import { isHostOp } from '../../functions/perfFunctions';

interface StackedPerformanceTableProps {
    data: TypedPerfTableRow[];
    filters: Record<string, string> | null;
    stackedData?: TypedStackedPerfRow[];
    reportName?: string;
}

const NO_META_DATA = 'n/a';

const StackedPerformanceTable: FC<StackedPerformanceTableProps> = ({ data, stackedData, filters, reportName }) => {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useSortTable(null);
    const { error: npeManifestError } = useGetNPEManifest();
    const { data: deviceLog, isLoading: isLoadingDeviceLog } = useDeviceLog(reportName);

    const architecture = deviceLog?.deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE;
    const maxCores = data ? getCoreCount(architecture, data) : 0;

    const tableFields = useMemo<TypedStackedPerfRow[]>(() => {
        const parsedRows = stackedData
            ? sortAndFilterStackedPerfTableData(stackedData, filters, FilterableStackedColumnKeys)
            : [];

        // Still some awkward casting here
        return [...sortTableFields(parsedRows as [])];
    }, [stackedData, filters, sortTableFields]);

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

            <div className='meta-data'>
                {isLoadingDeviceLog ? (
                    <LoadingSpinner size={LoadingSpinnerSizes.SMALL} />
                ) : (
                    <>
                        <p>
                            <strong>Arch: </strong>
                            {architecture || NO_META_DATA}
                        </p>
                        <p>
                            <strong>Cores: </strong>
                            {maxCores || NO_META_DATA}
                        </p>
                    </>
                )}
            </div>

            <table className='perf-table monospace'>
                <thead className='table-header'>
                    <tr>
                        {TableHeaders.map((h) => {
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
                                </th>
                            );
                        })}
                    </tr>
                </thead>

                <tbody>
                    {tableFields?.map((row, i) => (
                        <tr key={i}>
                            {TableHeaders.map((h: StackedTableHeader) => (
                                <td
                                    key={h.key}
                                    className={classNames('cell')}
                                >
                                    {formatStackedCell(row, h, filters?.[h.key])}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>

                <tfoot className='table-footer'>
                    <tr>
                        {stackedData &&
                            stackedData?.length > 0 &&
                            TableHeaders.map((header) => (
                                <td
                                    key={header.key}
                                    className={classNames({
                                        'no-wrap': header.key === ColumnHeaders.OpCodeJoined,
                                    })}
                                >
                                    {getTotalsForHeader(header, stackedData)}
                                </td>
                            ))}
                    </tr>
                </tfoot>
            </table>
        </>
    );
};

const getTotalsForHeader = (header: StackedTableHeader, data: TypedStackedPerfRow[]): string => {
    if (header.key === ColumnHeaders.Percent) {
        return `100 %`;
    }

    if (header.key === ColumnHeaders.DeviceTimeSumUs) {
        return `${formatSize(
            data?.reduce((acc, curr) => acc + (curr.device_time_sum_us || 0), 0),
            2,
        )} µs`;
    }

    if (header.key === ColumnHeaders.OpCodeJoined) {
        return `${data.filter((row) => !isHostOp(row.op_code)).length} device op types`;
    }

    if (header.key === ColumnHeaders.OpsCount) {
        return `${data?.reduce((acc, curr) => acc + (curr.ops_count || 0), 0)}`;
    }

    return '';
};

export default StackedPerformanceTable;
