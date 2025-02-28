// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

/* eslint camelcase: "off" */
import React, { FC, Fragment, useState } from 'react';
import '../../scss/components/PerfTable.scss';
import { Icon, Switch, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { evaluate_fidelity } from '../../functions/perfFunctions';
import { MathFidelity, PerfTableRow } from '../../definitions/PerfTable';
import { formatSize, toSecondsPretty } from '../../functions/math';

type CellColour = 'white' | 'green' | 'red' | 'blue' | 'magenta' | 'cyan' | 'yellow' | 'grey';

interface PerformanceReportProps {
    data?: PerfTableRow[];
}

type TableKeys = Partial<keyof PerfTableRow>;

interface TableHeader {
    label: string;
    key: TableKeys;
    colour?: string;
    unit?: string;
    decimals?: number;
}

interface TableRow extends PerfTableRow {
    high_dispatch: boolean;
}

const MIN_PERCENTAGE = 0.5;
const OPERATION_COLOURS: { [key: string]: CellColour } = {
    '(torch)': 'red',
    Matmul: 'magenta',
    LayerNorm: 'cyan',
    AllGather: 'cyan',
    AllReduce: 'cyan',
    ScaledDotProductAttentionDecode: 'blue',
    ScaledDotProductAttentionGQADecode: 'blue',
    NlpCreateHeadsDeviceOperation: 'blue',
    NLPConcatHeadsDecodeDeviceOperation: 'blue',
    UpdateCache: 'blue',
};

const TABLE_HEADERS: TableHeader[] = [
    { label: 'ID', key: 'id' },
    { label: 'OP', key: 'op' },
    { label: 'Total %', key: 'total_percent', unit: '%' },
    { label: 'Bound', key: 'bound', colour: 'yellow' },
    { label: 'OP Code', key: 'op_code', colour: 'blue' },
    { label: 'Device Time', key: 'device_time', unit: 'µs', decimals: 0 },
    { label: 'Op-to-Op Gap', key: 'op_to_op_gap', colour: 'red', unit: 'µs', decimals: 0 },
    { label: 'Cores', key: 'cores', colour: 'green' },
    { label: 'DRAM', key: 'dram', colour: 'yellow' },
    { label: 'DRAM %', key: 'dram_percent', colour: 'yellow', unit: '%' },
    { label: 'FLOPs', key: 'flops', unit: 'TFLOPs' },
    { label: 'FLOPs %', key: 'flops_percent', unit: '%' },
    { label: 'Math Fidelity', key: 'math_fidelity', colour: 'cyan' },
];

const NUMBER_KEYS_TO_PARSE = [
    'device_time',
    'op_to_op_gap',
    'cores',
    'total_percent',
    'dram',
    'dram_percent',
    'flops',
    'flops_percent',
];

export const PerformanceReport: FC<PerformanceReportProps> = ({ data }) => {
    const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState<boolean>(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState<boolean>(false);
    const [isMultiDevice, _setIsMultiDevice] = useState<boolean>(false);
    // const selectedRange = useAtomValue(selectedPerformanceRangeAtom);
    // const opIdsMap = useOptoPerfIdFiltered();

    const processedRows: TableRow[] =
        data?.map((op_data) => {
            const val = parseInt(op_data.op_to_op_gap, 10);

            return {
                ...op_data,
                high_dispatch: !!val && val > 6.5,
            };
        }) || [];

    const getFilteredRows = (): TableRow[] => {
        return processedRows;

        // return selectedRange && processedRows.length > 0
        //     ? processedRows.filter((row) => {
        //           const rowId = parseInt(row?.id, 10);

        //           return rowId >= selectedRange[0] && rowId <= selectedRange[1];
        //       })
        //     : processedRows;
    };

    const visibleHeaders = (
        hiliteHighDispatch
            ? [...TABLE_HEADERS.slice(0, 5), { label: 'Slow', key: 'high_dispatch' }, ...TABLE_HEADERS.slice(5)]
            : TABLE_HEADERS
    ) as TableHeader[];

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

            <div
                className='perf-table'
                style={{ background: '#222', color: '#fff', padding: '1rem' }}
            >
                <h3>Performance report</h3>
                <table
                    className='monospace'
                    style={{ borderCollapse: 'collapse', width: '100%' }}
                >
                    <thead>
                        <tr>
                            {visibleHeaders.map((h) => (
                                <th
                                    key={h.key}
                                    style={{ textAlign: 'left', borderBottom: '1px solid #555' }}
                                >
                                    {h.label}
                                </th>
                            ))}
                        </tr>
                    </thead>

                    <tbody>
                        {getFilteredRows().map((row, i) => (
                            <Fragment key={i}>
                                <tr key={i}>
                                    {visibleHeaders.map((header) => (
                                        <td
                                            key={header.key}
                                            style={{ borderBottom: '1px solid #333', padding: '0.25rem' }}
                                        >
                                            {formatCell(row, header)}
                                        </td>
                                    ))}
                                </tr>
                                {provideMatmulAdvice &&
                                    row.op_code.includes('Matmul') &&
                                    row?.advice.map((advice, j) => (
                                        <tr key={`advice-${j}`}>
                                            <td colSpan={4} />
                                            <td
                                                colSpan={visibleHeaders.length - 4}
                                                style={{ padding: '0.25rem' }}
                                            >
                                                {advice}
                                            </td>
                                        </tr>
                                    ))}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            <hr />

            {hiliteHighDispatch && calcDispatchOps(processedRows)}
        </>
    );
};

// const analyze_op = (row: PerfTableRow, prevRow: PerfTableRow | null): ProcessedRow => {
//     const op_code_val = row.op_code || '';

//     let dram_speed: Cell = { raw_value: null, unit: 'GB/s' };
//     let dram_percentage: Cell = { raw_value: null, unit: '%' };
//     let flops: Cell = { raw_value: null, unit: 'TFLOPs' };
//     let flops_percentage: Cell = { raw_value: null, unit: '%' };
//     let math_fidelity_cell: Cell = { raw_value: null };
//     let output_datatype_cell: Cell = { raw_value: null };
//     let input_0_datatype_cell: Cell = { raw_value: null };
//     let input_1_datatype_cell: Cell = { raw_value: null };
//     const bound: Cell = { raw_value: '' };
//     let is_dram_sharded_cell: Cell = { raw_value: false };
//     let in0_block_w: Cell = { raw_value: null };
//     let out_subblock_h: Cell = { raw_value: null };
//     let out_subblock_w: Cell = { raw_value: null };

//     if (op_code_val.includes('Matmul')) {
//         const {
//             dram_speed_gb_s,
//             dram_percentage: dram_p,
//             flops_val,
//             flops_percentage: f_p,
//             size,
//             math_fidelity,
//             is_dram_sharded,
//             input_0_datatype,
//             input_1_datatype,
//             output_datatype,
//         } = analyze_matmul(row);

//         dram_speed = { raw_value: dram_speed_gb_s, unit: 'GB/s', decimals: 0 };
//         dram_percentage = { raw_value: dram_p, unit: '%', decimals: 1 };
//         flops = { raw_value: flops_val != null ? flops_val / 1e12 : null, unit: 'TFLOPs', decimals: 1 };
//         flops_percentage = { raw_value: f_p, unit: '%', decimals: 1 };
//         const shortName = (n: string) => ({ BFLOAT16: 'BF16', BFLOAT8_B: 'BFP8', BFLOAT4_B: 'BFP4' })[n] || n;

//         if (math_fidelity) {
//             math_fidelity_cell = {
//                 raw_value:
//                     `${math_fidelity} ${shortName(input_0_datatype)} x ${shortName(input_1_datatype)} => ${shortName(output_datatype)}`.trim(),
//             };
//         }

//         output_datatype_cell = { raw_value: output_datatype };
//         input_0_datatype_cell = { raw_value: input_0_datatype };
//         input_1_datatype_cell = { raw_value: input_1_datatype };
//         is_dram_sharded_cell = { raw_value: is_dram_sharded };

//         const attributes = String(row.ATTRIBUTES || '');
//         const in0match = attributes.match(/in0_block_w=(\d+)/);
//         if (in0match) {
//             in0_block_w = { raw_value: Number(in0match[1]) };
//         }
//         const outHmatch = attributes.match(/out_subblock_h=(\d+)/);
//         if (outHmatch) {
//             out_subblock_h = { raw_value: Number(outHmatch[1]) };
//         }
//         const outWmatch = attributes.match(/out_subblock_w=(\d+)/);
//         if (outWmatch) {
//             out_subblock_w = { raw_value: Number(outWmatch[1]) };
//         }

//         const op_code = `${op_code_val} ${String(size)}`;

//         return {
//             ID: { raw_value: null },
//             OP: { raw_value: null },
//             'Total %': { raw_value: null },
//             Bound: bound,
//             'OP Code': { raw_value: op_code },
//             'Device Time': { raw_value: row.device_time, unit: 'µs', decimals: 0 },
//             'Op-to-Op Gap': { raw_value: row.op_to_op_gap, unit: 'µs', decimals: 0 },
//             Cores: { raw_value: row.cores },
//             DRAM: dram_speed,
//             'DRAM %': dram_percentage,
//             FLOPs: flops,
//             'FLOPs %': flops_percentage,
//             'Math Fidelity': math_fidelity_cell,
//             'Output Datatype': output_datatype_cell,
//             'Input 0 Datatype': input_0_datatype_cell,
//             'Input 1 Datatype': input_1_datatype_cell,
//             'DRAM Sharded': is_dram_sharded_cell,
//             'Input 0 Memory': { raw_value: row.input_0_memory || null },
//             'Inner Dim Block Size': in0_block_w,
//             'Output Subblock H': out_subblock_h,
//             'Output Subblock W': out_subblock_w,
//         };
//     }

//     return {
//         ID: { raw_value: null },
//         OP: { raw_value: null },
//         'Total %': { raw_value: null },
//         Bound: bound,
//         'OP Code': { raw_value: op_code_val },
//         'Device Time': { raw_value: row.device_time || null, unit: 'µs', decimals: 0 },
//         'Op-to-Op Gap': { raw_value: row.op_to_op_gap, unit: 'µs', decimals: 0 },
//         Cores: { raw_value: row.cores || null },
//         DRAM: dram_speed,
//         'DRAM %': dram_percentage,
//         FLOPs: flops,
//         'FLOPs %': flops_percentage,
//         'Math Fidelity': math_fidelity_cell,
//         'Output Datatype': output_datatype_cell,
//         'Input 0 Datatype': input_0_datatype_cell,
//         'Input 1 Datatype': input_1_datatype_cell,
//         'DRAM Sharded': is_dram_sharded_cell,
//         'Input 0 Memory': { raw_value: row.input_0_memory || null },
//         'Inner Dim Block Size': { raw_value: null },
//         'Output Subblock H': { raw_value: null },
//         'Output Subblock W': { raw_value: null },
//     };
// };

const formatCell = (row: TableRow, header: TableHeader): React.JSX.Element | string => {
    const { key, unit, decimals } = header;
    let formatted: string | boolean | string[];

    if (key === 'high_dispatch') {
        return (
            <Tooltip content='Op with > 6µs dispatch latency'>
                <Icon
                    color='#ff0'
                    icon={IconNames.WARNING_SIGN}
                />
            </Tooltip>
        );
    }

    let value = row[key];

    if (NUMBER_KEYS_TO_PARSE.includes(key) && value) {
        value = typeof value === 'string' ? parseInt(value, 10) : value;
    }

    if (value == null || value === '') {
        return '';
    }

    if (typeof value === 'string' && value.includes('Matmul')) {
        // there was a logic here to do something clever with Matmul size, removing it for now
        formatted = `${value}`;
    } else if (typeof value === 'number') {
        formatted = formatSize(Number(value.toFixed(decimals ?? 0)));
    } else {
        formatted = value.toString();
    }

    if (unit) {
        formatted += ` ${unit}`;
    }

    return getCellMarkup(formatted, getCellColour(row, key));
};

const getCellMarkup = (text: string | string[], color?: string) => {
    if (!text) {
        return text;
    }

    if (color) {
        return <span className={color}> {text}</span>;
    }

    return <span>{text}</span>;
};

const getCellColour = (row: TableRow, key: TableKeys): CellColour | '' => {
    const keyValue = row[key];
    const percentage = parseInt(row.total_percent, 10);

    if (percentage != null && percentage < MIN_PERCENTAGE) {
        return 'grey';
    }

    if (key === 'id' || key === 'total_percent' || key === 'device_time') {
        return 'white';
    }

    if (key === 'bound') {
        if (keyValue === 'DRAM') {
            return 'green';
        }

        if (keyValue === 'FLOP') {
            return 'green';
        }

        if (keyValue === 'SLOW') {
            return 'yellow';
        }
    }

    if (key === 'dram' || key === 'dram_percent' || key === 'flops' || key === 'flops_percent') {
        const dram_p = row.dram_percent;
        const flops_p = row.flops_percent;

        if (dram_p != null && flops_p != null) {
            if (dram_p > flops_p) {
                if (key === 'dram' || key === 'dram_percent') {
                    return 'yellow';
                }
            } else if (key === 'flops' || key === 'flops_percent') {
                return 'yellow';
            }
        }

        if (keyValue === 'HOST') {
            return 'red';
        }

        return 'white';
    }

    if (key === 'cores') {
        if (keyValue != null && typeof keyValue === 'number') {
            if (keyValue < 10) {
                return 'red';
            }
            if (keyValue === 64) {
                return 'green';
            }
        } else {
            return '';
        }

        return 'white';
    }

    if (key === 'op_code') {
        const match =
            keyValue && typeof keyValue === 'string'
                ? Object.keys(OPERATION_COLOURS).find((opCodeKey) => keyValue.includes(opCodeKey))
                : false;

        return match ? OPERATION_COLOURS[match] : 'white';
    }

    if (key === 'math_fidelity' && typeof keyValue === 'string') {
        const parts = keyValue.split(' ');
        const math_fidelity = parts[0] as MathFidelity;
        const input_0_dt = row.input_0_datatype || '';
        const input_1_dt = row.input_1_datatype || '';
        const output_dt = row.output_datatype || '';
        const [fidelity_eval] = evaluate_fidelity(input_0_dt, input_1_dt, output_dt, math_fidelity);

        if (fidelity_eval === 'sufficient') {
            return 'green';
        }

        if (fidelity_eval === 'too_high') {
            return 'red';
        }

        if (fidelity_eval === 'too_low') {
            return 'cyan';
        }

        return 'white';
    }

    if (key === 'op_to_op_gap' && typeof keyValue === 'string') {
        const parsedValue = keyValue ? parseInt(keyValue, 10) : 0;

        return parsedValue > 6.5 ? 'red' : '';
    }

    // Shouldn't get to this point
    return 'grey';
};

const calcDispatchOps = (rows: TableRow[]) => {
    const highDispatchOps = rows
        .map((op_data: TableRow, index: number): [number, TableRow] => [index + 1, op_data])
        .filter(([_, op_data]) => {
            const val = op_data.op_to_op_gap;
            return val !== null && val !== undefined && typeof val === 'number' && val > 6.5;
        });

    if (highDispatchOps.length === 0) {
        return null; // No high dispatch overhead ops, so no advice section
    }

    // Compute the max dispatch overhead
    const max_dispatch_overhead = highDispatchOps.reduce((acc, [_, op_data]) => {
        const val = parseInt(op_data.op_to_op_gap, 10);

        return acc + (val - 6);
    }, 0);

    // Compute total_duration as sum of device times + Op-to-Op Gaps
    const total_device_time = rows.reduce((acc, r) => {
        const val = parseInt(r.device_time, 10);

        return acc + (typeof val === 'number' ? val : 0);
    }, 0);

    const total_dispatch_time = rows.reduce((acc, r) => {
        const val = r.op_to_op_gap;

        return acc + (typeof val === 'number' ? val : 0);
    }, 0);

    const total_duration = total_device_time + total_dispatch_time;
    const percentage_saved = (max_dispatch_overhead / total_duration) * 100;

    return (
        <div>
            <p>
                Marked ops have &gt; 6µs dispatch latency. Running with tracing could save{' '}
                {formatSize(Number(max_dispatch_overhead.toFixed(0)))} µs {toSecondsPretty(max_dispatch_overhead)} (
                {percentage_saved.toFixed(1)}% of overall time).
            </p>
            <p>Alternatively, try moving runtime args in the kernels to compile-time args.</p>
        </div>
    );
};
