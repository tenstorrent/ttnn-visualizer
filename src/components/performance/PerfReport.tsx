// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, Fragment, useMemo, useState } from 'react';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { Switch } from '@blueprintjs/core';
import { PerfTableRow, TableHeader } from '../../definitions/PerfTable';
import { selectedPerformanceRangeAtom } from '../../store/app';
import 'styles/components/PerfReport.scss';
import { useOperationsList, useOptoPerfIdFiltered } from '../../hooks/useAPI';
import { calcHighDispatchOps, formatCell } from '../../functions/perfFunctions';

interface PerformanceReportProps {
    data?: PerfTableRow[];
}

const TABLE_HEADERS: TableHeader[] = [
    { label: 'ID', key: 'id' },
    { label: 'Total %', key: 'total_percent', unit: '%', decimals: 1 },
    { label: 'Bound', key: 'bound', colour: 'yellow' },
    { label: 'OP Code', key: 'op_code', colour: 'blue' },
    { label: 'Device Time', key: 'device_time', unit: 'µs', decimals: 0 },
    { label: 'Op-to-Op Gap', key: 'op_to_op_gap', colour: 'red', unit: 'µs', decimals: 0 },
    { label: 'Cores', key: 'cores', colour: 'green' },
    { label: 'DRAM', key: 'dram', colour: 'yellow', unit: 'GB/s' },
    { label: 'DRAM %', key: 'dram_percent', colour: 'yellow', unit: '%' },
    { label: 'FLOPs', key: 'flops', unit: 'TFLOPs' },
    { label: 'FLOPs %', key: 'flops_percent', unit: '%' },
    { label: 'Math Fidelity', key: 'math_fidelity', colour: 'cyan' },
];

const OP_ID_INSERTION_POINT = 1;
const HIGH_DISPATCH_INSERTION_POINT = 5;

const PerformanceReport: FC<PerformanceReportProps> = ({ data }) => {
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
        return selectedRange && processedRows.length > 0
            ? processedRows.filter((row) => {
                  const rowId = parseInt(row?.id, 10);
                  return rowId >= selectedRange[0] && rowId <= selectedRange[1];
              })
            : processedRows;
    }, [processedRows, selectedRange]);

    const visibleHeaders = [
        ...TABLE_HEADERS.slice(0, OP_ID_INSERTION_POINT),
        ...(opIdsMap.length > 0 ? [{ label: 'OP', key: 'op' }] : [{}]),
        ...TABLE_HEADERS.slice(OP_ID_INSERTION_POINT, HIGH_DISPATCH_INSERTION_POINT),
        ...(hiliteHighDispatch ? [{ label: 'Slow', key: 'high_dispatch' }] : [{}]),
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
                <table className='perf-table monospace'>
                    <thead>
                        <tr>
                            {visibleHeaders.map((h) => (
                                <th
                                    key={h.key}
                                    className='cell-header'
                                >
                                    {h.label}
                                </th>
                            ))}
                        </tr>
                    </thead>

                    <tbody>
                        {getFilteredRows.map((row, i) => (
                            <Fragment key={i}>
                                <tr key={i}>
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
