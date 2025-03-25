// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, Fragment, useMemo, useState } from 'react';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { Button, Icon, Switch } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { PerfTableRow, TableHeader } from '../../definitions/PerfTable';
import { selectedPerformanceRangeAtom } from '../../store/app';
import 'styles/components/PerfReport.scss';
import { useOperationsList, useOptoPerfIdFiltered } from '../../hooks/useAPI';
import { calcHighDispatchOps, formatCell } from '../../functions/perfFunctions';
import useBuffersTable, { SortingDirection } from '../../hooks/useBuffersTable';

interface PerformanceReportProps {
    data?: PerfTableRow[];
}

interface TypedPerfTableRow
    extends Omit<
        PerfTableRow,
        | 'id'
        | 'total_percent'
        | 'device_time'
        | 'op_to_op_gap'
        | 'cores'
        | 'dram'
        | 'dram_percent'
        | 'flops'
        | 'flops_percent'
    > {
    id: number;
    total_percent: number;
    device_time: number;
    op_to_op_gap: number | null;
    cores: number;
    dram: number;
    dram_percent: number;
    flops: number;
    flops_percent: number;
}

const TABLE_HEADERS: TableHeader[] = [
    { label: 'ID', key: 'id', sortable: true },
    { label: 'Total %', key: 'total_percent', unit: '%', decimals: 1, sortable: true },
    { label: 'Bound', key: 'bound', colour: 'yellow', filterable: true },
    { label: 'OP Code', key: 'op_code', colour: 'blue', sortable: true },
    { label: 'Device Time', key: 'device_time', unit: 'µs', decimals: 0, sortable: true },
    { label: 'Op-to-Op Gap', key: 'op_to_op_gap', colour: 'red', unit: 'µs', decimals: 0, sortable: true },
    { label: 'Cores', key: 'cores', colour: 'green', sortable: true },
    { label: 'DRAM', key: 'dram', colour: 'yellow', unit: 'GB/s', sortable: true },
    { label: 'DRAM %', key: 'dram_percent', colour: 'yellow', unit: '%', sortable: true },
    { label: 'FLOPs', key: 'flops', unit: 'TFLOPs', sortable: true },
    { label: 'FLOPs %', key: 'flops_percent', unit: '%', sortable: true },
    { label: 'Math Fidelity', key: 'math_fidelity', colour: 'cyan' },
];

const OP_ID_INSERTION_POINT = 1;
const HIGH_DISPATCH_INSERTION_POINT = 5;

const PerformanceReport: FC<PerformanceReportProps> = ({ data }) => {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useBuffersTable(null);
    const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState<boolean>(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState<boolean>(false);
    const [isMultiDevice, _setIsMultiDevice] = useState<boolean>(false);
    const selectedRange = useAtomValue(selectedPerformanceRangeAtom);
    const opIdsMap = useOptoPerfIdFiltered();
    const { data: operations } = useOperationsList();

    const processedRows: PerfTableRow[] = useMemo(() => {
        return (
            data?.map((opData) => {
                const val = parseInt(opData.op_to_op_gap, 10);
                const op = opIdsMap.find((opMap) => opMap.perfId === opData.id)?.opId;
                return {
                    ...opData,
                    high_dispatch: !!val && val > 6.5,
                    op,
                };
            }) || []
        );
    }, [data, opIdsMap]);

    const getFilteredRows: PerfTableRow[] = useMemo(() => {
        const filteredRows =
            selectedRange && processedRows.length > 0
                ? processedRows.filter((row) => {
                      const rowId = parseInt(row?.id, 10);
                      return rowId >= selectedRange[0] && rowId <= selectedRange[1];
                  })
                : processedRows;

        // console.log(data);

        const parsedRows = filteredRows.map((row) => ({
            ...row,
            id: parseInt(row.id, 10),
            total_percent: parseFloat(row.total_percent),
            device_time: parseFloat(row.device_time),
            op_to_op_gap: row.op_to_op_gap ? parseFloat(row.op_to_op_gap) : null,
            cores: parseInt(row.cores, 10),
            dram: row.dram ? parseFloat(row.dram) : null,
            dram_percent: row.dram_percent ? parseFloat(row.dram_percent) : null,
            flops: row.flops ? parseFloat(row.flops) : null,
            flops_percent: row.flops_percent ? parseFloat(row.flops_percent) : null,
        })) as TypedPerfTableRow[];

        return sortTableFields(parsedRows);
    }, [processedRows, selectedRange, sortTableFields]);

    const visibleHeaders = [
        ...TABLE_HEADERS.slice(0, OP_ID_INSERTION_POINT),
        ...(opIdsMap.length > 0 ? [{ label: 'OP', key: 'op', sortable: true }] : []),
        ...TABLE_HEADERS.slice(OP_ID_INSERTION_POINT, HIGH_DISPATCH_INSERTION_POINT),
        ...(hiliteHighDispatch ? [{ label: 'Slow', key: 'high_dispatch', filterable: true }] : []),
        ...TABLE_HEADERS.slice(HIGH_DISPATCH_INSERTION_POINT),
    ] as TableHeader[];

    return (
        <>
            <Switch
                className='expand-button'
                label={!mergeDeviceData ? 'Expanded device data' : 'Merged device data'}
                onChange={() => setMergeDeviceData(!mergeDeviceData)}
                checked={mergeDeviceData && isMultiDevice}
                disabled={!isMultiDevice}
            />
            <Switch
                className='expand-button'
                label={provideMatmulAdvice ? 'Hide Matmul optimization analysis' : 'Show Matmul optimization analysis'}
                onChange={() => setProvideMatmulAdvice(!provideMatmulAdvice)}
                checked={provideMatmulAdvice}
            />
            <Switch
                className='expand-button'
                label='Highlight high dispatch ops'
                onChange={() => setHiliteHighDispatch(!hiliteHighDispatch)}
                checked={hiliteHighDispatch}
            />

            <div className='perf-report'>
                <h3 className='title'>Performance report</h3>
                Sorting: {sortingColumn} by {sortDirection}
                <Button
                    icon={IconNames.RESET}
                    onClick={() => changeSorting(null)(null)}
                >
                    Reset
                </Button>
                <table className='perf-table monospace'>
                    <thead>
                        <tr>
                            {visibleHeaders.map((h) => {
                                const isSortable = visibleHeaders?.find((header) => header.key === h.key)?.sortable;

                                if (isSortable) {
                                    let targetSortDirection = sortDirection;

                                    if (sortingColumn === h.key) {
                                        targetSortDirection =
                                            sortDirection === SortingDirection.ASC
                                                ? SortingDirection.DESC
                                                : SortingDirection.ASC;
                                    }

                                    return (
                                        <th
                                            className='cell-header'
                                            key={h.key}
                                        >
                                            <Button
                                                onClick={() => changeSorting(h.key)(targetSortDirection)}
                                                variant='minimal'
                                                size='small'
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
                                        </th>
                                    );
                                }
                                return (
                                    <th
                                        key={h.key}
                                        className='cell-header'
                                    >
                                        {h.label}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    <tbody>
                        {getFilteredRows.map((row, i) => (
                            <Fragment key={i}>
                                <tr>
                                    {visibleHeaders.map((header) => (
                                        <td
                                            key={header.key}
                                            className={classNames('cell', {
                                                'align-right': header.key === 'math_fidelity',
                                            })}
                                        >
                                            {formatCell(row, header, operations)}
                                        </td>
                                    ))}
                                </tr>
                                {provideMatmulAdvice && row.op_code.includes('Matmul') && (
                                    <tr>
                                        <td
                                            colSpan={visibleHeaders.length}
                                            className='cell advice'
                                        >
                                            <ul>
                                                {row?.advice.map((advice, j) => <li key={`advice-${j}`}>{advice}</li>)}
                                            </ul>
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
            <hr />
            {hiliteHighDispatch && calcHighDispatchOps(processedRows)}
        </>
    );
};

export default PerformanceReport;
