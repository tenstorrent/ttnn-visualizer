// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonVariant, Icon, Intent, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import classNames from 'classnames';
import { useAtomValue, useSetAtom } from 'jotai';
import { Fragment, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import 'styles/components/PerfReport.scss';
import { OpType, PATTERN_COUNT } from '../../definitions/Performance';
import {
    ColumnDefinition,
    ColumnKeys,
    PerfTableFilters,
    TypedPerfTableRow,
    comparisonKeys,
    getEligiblePerfColumns,
    getFooterColumns,
    getVisiblePerfColumns,
} from '../../definitions/PerfTable';
import ROUTES from '../../definitions/Routes';
import { TEST_IDS } from '../../definitions/TestIds';
import isValidNumber from '../../functions/isValidNumber';
import { formatPercentage, formatSize } from '../../functions/math';
import { formatCell, isHostOp } from '../../functions/perfFunctions';
import { useGetNPEManifest, useOpToPerfIdFiltered, useOperationsList } from '../../hooks/useAPI';
import useSortTable, { SortingDirection } from '../../hooks/useSortTable';
import { OperationDescription } from '../../model/APIData';
import { hideHostOpsAtom, mergeDevicesAtom, selectedPerfRowIdAtom, userPerfColumnsAtom } from '../../store/app';
import LoadingSpinner from '../LoadingSpinner';
import PerfDeviceArchitecture from './PerfDeviceArchitecture';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';
import PerfTensorDrawer from './PerfTensorDrawer';
import PerfTableToolbar from './PerfTableToolbar';

interface PerformanceTableProps {
    data: TypedPerfTableRow[];
    comparisonData?: TypedPerfTableRow[][];
    filters: PerfTableFilters;
    provideMatmulAdvice: boolean;
    hiliteHighDispatch: boolean;
    reportName: string | null;
    showHashColumn: boolean;
    hasL1PressureData?: boolean;
    // Identifies which comparison dataset holds the active profiler report's rows. The
    // tensor-drawer trigger only renders on those rows, since op-id sync from
    // `useOpToPerfIdFiltered()` and tensor lookups in `useOperationsList()` are both
    // keyed to the active report. When `null` (default), `data` is the active report
    // and triggers render on the primary rows.
    activeReportComparisonIndex?: number | null;
}

const PerformanceTable = ({
    data,
    comparisonData,
    filters,
    provideMatmulAdvice,
    hiliteHighDispatch,
    reportName,
    showHashColumn,
    hasL1PressureData = false,
    activeReportComparisonIndex = null,
}: PerformanceTableProps) => {
    const hideHostOps = useAtomValue(hideHostOpsAtom);
    const userColumns = useAtomValue(userPerfColumnsAtom);
    const mergeDevices = useAtomValue(mergeDevicesAtom);
    const selectedPerfRowId = useAtomValue(selectedPerfRowIdAtom);
    const setSelectedPerfRowId = useSetAtom(selectedPerfRowIdAtom);

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

    // L1 pressure is a per-TTNN-op snapshot, so it renders only on the first device-op row of each
    // op. Derive that "first" row from the current display order (`tableFields`, post-sort) rather
    // than source order, so the value always lands on the topmost visible row of its op group —
    // matching what the user sees under any sort instead of an arbitrary execution-order row.
    const firstRowOfOpRun = useMemo<Set<TypedPerfTableRow>>(() => {
        const seenOps = new Set<number>();
        const firstRows = new Set<TypedPerfTableRow>();

        for (const row of tableFields) {
            if (row.op !== undefined && !seenOps.has(row.op)) {
                seenOps.add(row.op);
                firstRows.add(row);
            }
        }

        return firstRows;
    }, [tableFields]);

    const eligibleColumns = useMemo(
        () =>
            getEligiblePerfColumns({
                hasOpIds: opIdsMap.length > 0,
                hasL1PressureData,
                hiliteHighDispatch,
                showHashColumn,
                hasNpe: Boolean(npeManifest && npeManifest.length > 0),
            }),
        [opIdsMap.length, hasL1PressureData, hiliteHighDispatch, showHashColumn, npeManifest],
    );

    const visibleColumns = useMemo(
        () => getVisiblePerfColumns(eligibleColumns, userColumns),
        [eligibleColumns, userColumns],
    );

    const footerColumns = useMemo(() => getFooterColumns(visibleColumns), [visibleColumns]);

    const isReportsSynced = opIdsMap.length > 0;
    const isPrimaryActiveReport = activeReportComparisonIndex === null;
    const activeReportRows = useMemo<TypedPerfTableRow[]>(
        () => (isPrimaryActiveReport ? tableFields : (comparisonDataTableFields[activeReportComparisonIndex] ?? [])),
        [isPrimaryActiveReport, tableFields, comparisonDataTableFields, activeReportComparisonIndex],
    );
    const canShowTensorDrawer = isReportsSynced && activeReportRows.length > 0;

    useEffect(() => {
        if (!canShowTensorDrawer) {
            setSelectedPerfRowId(null);
            return;
        }

        // Drop the selection when filters/range no longer include the row
        if (selectedPerfRowId !== null && !activeReportRows.some((row) => row.id === selectedPerfRowId)) {
            setSelectedPerfRowId(null);
        }
    }, [canShowTensorDrawer, activeReportRows, selectedPerfRowId, setSelectedPerfRowId]);

    const getTensorDrawerStatus = (row: TypedPerfTableRow): { canOpen: boolean; reason: string } => {
        if (!isReportsSynced) {
            return { canOpen: false, reason: 'Load a synced profiler report to see tensor details' };
        }

        if (row.raw_op_code.includes('MISSING')) {
            return { canOpen: false, reason: 'No tensor data for missing operations' };
        }

        if (!isValidNumber(row.op)) {
            return { canOpen: false, reason: 'No linked profiler operation for this row' };
        }

        return { canOpen: true, reason: 'View input/output tensor details' };
    };

    const renderTensorDrawerTrigger = (row: TypedPerfTableRow) => {
        if (row.op_type === OpType.SIGNPOST) {
            return null;
        }

        const status = getTensorDrawerStatus(row);

        return (
            <Tooltip content={status.reason}>
                {/* span wrapper lets the Tooltip attach to disabled buttons (Blueprint quirk) */}
                <span className='perf-tensor-trigger-wrapper'>
                    <Button
                        className='perf-tensor-trigger'
                        disabled={!status.canOpen}
                        icon={IconNames.FLOW_LINEAR}
                        intent={Intent.PRIMARY}
                        variant={ButtonVariant.MINIMAL}
                        size={Size.SMALL}
                        aria-label={`View tensor details for ${row.raw_op_code}`}
                        data-testid={TEST_IDS.PERF_TENSOR_DRAWER_OPEN_BUTTON}
                        onClick={() => setSelectedPerfRowId(row.id)}
                    />
                </span>
            </Tooltip>
        );
    };

    const cellFormattingProxy = (
        row: TypedPerfTableRow,
        column: ColumnDefinition,
        operations?: OperationDescription[],
        highlight?: string | null,
        isFirstOfOpRun: boolean = true,
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

        return formatCell(row, column, operations, highlight, isFirstOfOpRun);
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

            <PerfTableToolbar eligibleColumns={eligibleColumns} />

            {data?.length > 0 ? (
                <table className='perf-table monospace'>
                    <thead className='table-header'>
                        <tr>
                            <th
                                className='cell-header'
                                aria-label='Tensor details'
                            />
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
                        {tableFields?.map((row, i) => {
                            const isFirstOfOpRun = row.op === undefined || firstRowOfOpRun.has(row);
                            const isSignpost = row.op_type === OpType.SIGNPOST;
                            const isPrimarySelected = isPrimaryActiveReport && row.id === selectedPerfRowId;

                            return (
                                <Fragment key={i}>
                                    <tr
                                        className={classNames({
                                            'missing-data': row.raw_op_code.includes('MISSING'),
                                            'signpost-op': isSignpost,
                                            'is-selected': isPrimarySelected,
                                        })}
                                    >
                                        <td className='cell'>
                                            {isPrimaryActiveReport && renderTensorDrawerTrigger(row)}
                                        </td>
                                        {visibleColumns.map((h) => (
                                            <td
                                                key={h.key}
                                                className={classNames('cell', {
                                                    'align-right': h.key === ColumnKeys.MathFidelity,
                                                })}
                                            >
                                                {cellFormattingProxy(
                                                    row,
                                                    h,
                                                    operationsList,
                                                    filters?.[h.key],
                                                    isFirstOfOpRun,
                                                )}
                                            </td>
                                        ))}
                                    </tr>

                                    {comparisonDataTableFields?.length > 0 &&
                                        comparisonDataTableFields.map((dataset, index) => {
                                            const subRow = dataset[i];
                                            const isActiveReportRow = index === activeReportComparisonIndex;
                                            const isSubRowSelected =
                                                isActiveReportRow && subRow?.id === selectedPerfRowId;

                                            return (
                                                <tr
                                                    key={`comparison-${i}-${index}`}
                                                    className={classNames(
                                                        {
                                                            'missing-data': subRow?.raw_op_code?.includes('MISSING'),
                                                            'signpost-op': subRow?.op_type === OpType.SIGNPOST,
                                                            'is-selected': isSubRowSelected,
                                                        },
                                                        'comparison-row',
                                                        `pattern-${index >= PATTERN_COUNT ? index - PATTERN_COUNT : index}`,
                                                    )}
                                                >
                                                    <td className='cell'>
                                                        {isActiveReportRow && subRow
                                                            ? renderTensorDrawerTrigger(subRow)
                                                            : null}
                                                    </td>
                                                    {visibleColumns.map((h) => (
                                                        <td
                                                            key={h.key}
                                                            className={classNames('cell', {
                                                                'align-right': h.key === ColumnKeys.MathFidelity,
                                                            })}
                                                        >
                                                            {comparisonKeys.includes(h.key) &&
                                                                subRow &&
                                                                formatCell(subRow, h, operationsList, filters?.[h.key])}
                                                        </td>
                                                    ))}
                                                </tr>
                                            );
                                        })}
                                    {provideMatmulAdvice && row.op_code.includes('Matmul') && (
                                        <tr>
                                            <td
                                                colSpan={visibleColumns.length + 1}
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
                            );
                        })}
                    </tbody>

                    <tfoot className='table-footer'>
                        <tr>
                            <td />
                            {visibleColumns.length > 0 &&
                                data?.length > 0 &&
                                footerColumns.map((header) => (
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

            {canShowTensorDrawer && <PerfTensorDrawer rows={activeReportRows} />}
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
