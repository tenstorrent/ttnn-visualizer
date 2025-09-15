// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useMemo } from 'react';
import classNames from 'classnames';
import { Button, ButtonVariant, Icon, Intent, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import {
    FilterableColumnKeys,
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
import { formatStackedCell, isStackedHostOp } from '../../functions/stackedPerfFunctions';
import { TypedPerfTableRow } from '../../definitions/PerfTable';

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
            ? sortAndFilterStackedPerfTableData(
                  stackedData.filter((row) => !isStackedHostOp(row)),
                  filters,
                  FilterableColumnKeys,
              )
            : [];

        // Still some awkward casting here
        return [...sortTableFields(parsedRows as [])];
    }, [stackedData, sortTableFields, filters]);

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
                <thead>
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
            </table>
        </>
    );
};

export default StackedPerformanceTable;
