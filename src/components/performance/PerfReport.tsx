// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

/* eslint camelcase: "off" */
import React, { FC, Fragment, useState } from 'react';
import '../../scss/components/PerfTable.scss';
import { Switch } from '@blueprintjs/core';
import { useAtomValue } from 'jotai';
import { evaluate_fidelity } from '../../functions/perfFunctions';
import { Cell, MathFidelity, PerfTableRow, ProcessedRow } from '../../definitions/PerfTable';
import { useOptoPerfIdFiltered } from '../../hooks/useAPI';
import { selectedPerformanceRangeAtom } from '../../store/app';
import { formatSize } from '../../functions/math';

type CellColour = 'white' | 'green' | 'red' | 'blue' | 'magenta' | 'cyan' | 'yellow' | 'grey';

interface PerformanceReportProps {
    data?: PerfTableRow[];
}

interface TableHeader {
    label: string;
    key: Partial<keyof PerfTableRow>;
    colour?: string;
    unit?: string;
    decimals?: number;
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

export const PerformanceReport: FC<PerformanceReportProps> = ({ data }) => {
    const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState<boolean>(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState<boolean>(false);
    const [isMultiDevice, setIsMultiDevice] = useState<boolean>(false);
    const selectedRange = useAtomValue(selectedPerformanceRangeAtom);
    const opIdsMap = useOptoPerfIdFiltered();

    const processedRows =
        data.map((row) => ({
            ...row,
            device_time: row.device_time ? parseInt(row.device_time, 10) : null,
            op_to_op_gap: row.op_to_op_gap ? parseInt(row.op_to_op_gap, 10) : null,
            cores: parseInt(row.cores, 10),
            total_percent: row.total_percent ? parseInt(row.total_percent, 10) : null,
            dram: row.dram ? parseInt(row.dram, 10) : null,
            dram_percent: row.dram_percent ? parseInt(row.dram_percent, 10) : null,
            flops: row.flops ? parseInt(row.flops, 10) : null,
            flops_percent: row.flops_percent ? parseInt(row.flops_percent, 10) : null,
        })) ?? [];

    const getFilteredRows = () => {
        return processedRows;
        // return selectedRange && processedRows.length > 0
        //     ? processedRows.filter((row) => {
        //           const rowId = parseInt(row?.id, 10);

        //           return rowId >= selectedRange[0] && rowId <= selectedRange[1];
        //       })
        //     : processedRows;
    };

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
                            {TABLE_HEADERS.map((h) => (
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
                                    {TABLE_HEADERS.map((header) => (
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
                                                colSpan={TABLE_HEADERS.length - 4}
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
// const MatmulAdvice: FC<{ row: ProcessedRow; colSpan: number }> = ({ row, colSpan }) => {
//     const getMatmulOptimizationAdvice = (op_data: ProcessedRow) => {
//         const opCodeColor = op_data.op_code.color === 'grey' ? 'grey' : 'white';

//         // Extract needed fields
//         const math_fidelity_raw = op_data['Math Fidelity'].raw_value;
//         const math_fidelity =
//             typeof math_fidelity_raw === 'string' ? (math_fidelity_raw.split(' ')[0] as MathFidelity) : undefined;

//         const output_datatype = op_data['Output Datatype'].raw_value as string | undefined;
//         const input_0_datatype = op_data['Input 0 Datatype'].raw_value as string | undefined;
//         const input_1_datatype = op_data['Input 1 Datatype'].raw_value as string | undefined;
//         const cores = op_data.Cores.raw_value as number | undefined;
//         const fidelity_results = evaluate_fidelity(
//             input_0_datatype || '',
//             input_1_datatype || '',
//             output_datatype || '',
//             math_fidelity || '',
//         );
//         const [fidelity_evaluation, fidelity_advice] = fidelity_results;

//         const boundVal = op_data.Bound.raw_value as string | null;
//         const flops_pct = op_data['FLOPs %'].raw_value as number | null;
//         const dram_sharded = op_data['DRAM Sharded'].raw_value as boolean | null;
//         const input_0_memory = op_data['Input 0 Memory'].raw_value as string | null;
//         const inner_dim_block = op_data['Inner Dim Block Size'].raw_value as number | null;
//         const out_h = op_data['Output Subblock H'].raw_value as number | null;
//         const out_w = op_data['Output Subblock W'].raw_value as number | null;

//         // Compute advice lines
//         const advice: string[] = [];

//         if (boundVal === 'DRAM' || boundVal === 'BOTH') {
//             if (!dram_sharded) {
//                 advice.push(
//                     'Try a DRAM-sharded program config (MatmulMultiCoreReuseMultiCastDRAMShardedProgramConfig) to improve throughput further',
//                 );
//             }
//             if (fidelity_evaluation === 'too_low' && flops_pct !== null && flops_pct < 40) {
//                 if (fidelity_advice) {
//                     advice.push(`${fidelity_advice}`);
//                 }
//             }
//             if (fidelity_evaluation === 'too_high' && fidelity_advice) {
//                 advice.push(`${fidelity_advice}`);
//             }
//         } else if (boundVal === 'FLOP' || boundVal === 'BOTH') {
//             if (cores !== undefined && cores < 64) {
//                 advice.push(`Increase grid size (currently using ${cores})`);
//             }
//             if (fidelity_evaluation === 'too_high' && fidelity_advice) {
//                 advice.push(`${fidelity_advice}`);
//             }
//         } else if (boundVal === 'SLOW') {
//             if (input_0_memory && !input_0_memory.includes('L1')) {
//                 advice.push(`If possible place input 0 in L1 (currently in ${input_0_memory})`);
//             }

//             let all_good = true;
//             if (inner_dim_block === null && out_h === null && out_w === null) {
//                 advice.push('No program_config specified, try using one to override in0_block_w and out_subblock_h/w');
//             } else {
//                 if (inner_dim_block !== null) {
//                     if (inner_dim_block < 2) {
//                         advice.push(`in0_block_w=${inner_dim_block} is small, try in0_block_w=2 or above`);
//                         all_good = false;
//                     }
//                 } else {
//                     advice.push('No inner dim block size found');
//                     all_good = false;
//                 }

//                 if (out_h !== null && out_w !== null) {
//                     const out_area = out_h * out_w;
//                     if (out_area < 2) {
//                         advice.push(
//                             `Output subblock ${out_h}x${out_w} is small, try out_subblock_h * out_subblock_w >= 2 if possible`,
//                         );
//                         all_good = false;
//                     }
//                 } else {
//                     advice.push('No output subblock size found');
//                     all_good = false;
//                 }

//                 if (all_good) {
//                     advice.push(`in0_block_w=${inner_dim_block} and output subblock ${out_h}x${out_w} look good 🤷`);
//                 }
//                 if (fidelity_advice) {
//                     advice.push(`${fidelity_advice}`);
//                 }
//             }
//         }

//         return advice.length > 0 ? (
//             <ul>
//                 {advice.map((item, idx) => (
//                     <li
//                         key={idx}
//                         style={{ paddingLeft: '1rem', color: opCodeColor }}
//                     >
//                         {item}
//                     </li>
//                 ))}
//             </ul>
//         ) : (
//             <ul>
//                 <li
//                     key={1}
//                     style={{ color: opCodeColor }}
//                 >
//                     ✅ Optimized
//                 </li>
//             </ul>
//         );
//     };
//     return (
//         <tr>
//             <td
//                 colSpan={colSpan}
//                 style={{ padding: '0.25rem' }}
//             >
//                 {getMatmulOptimizationAdvice(row)}
//             </td>
//         </tr>
//     );
// };

const analyze_op = (row: PerfTableRow, prevRow: PerfTableRow | null): ProcessedRow => {
    const op_code_val = row.op_code || '';

    let dram_speed: Cell = { raw_value: null, unit: 'GB/s' };
    let dram_percentage: Cell = { raw_value: null, unit: '%' };
    let flops: Cell = { raw_value: null, unit: 'TFLOPs' };
    let flops_percentage: Cell = { raw_value: null, unit: '%' };
    let math_fidelity_cell: Cell = { raw_value: null };
    let output_datatype_cell: Cell = { raw_value: null };
    let input_0_datatype_cell: Cell = { raw_value: null };
    let input_1_datatype_cell: Cell = { raw_value: null };
    const bound: Cell = { raw_value: '' };
    let is_dram_sharded_cell: Cell = { raw_value: false };
    let in0_block_w: Cell = { raw_value: null };
    let out_subblock_h: Cell = { raw_value: null };
    let out_subblock_w: Cell = { raw_value: null };

    if (op_code_val.includes('Matmul')) {
        const {
            dram_speed_gb_s,
            dram_percentage: dram_p,
            flops_val,
            flops_percentage: f_p,
            size,
            math_fidelity,
            is_dram_sharded,
            input_0_datatype,
            input_1_datatype,
            output_datatype,
        } = analyze_matmul(row);

        dram_speed = { raw_value: dram_speed_gb_s, unit: 'GB/s', decimals: 0 };
        dram_percentage = { raw_value: dram_p, unit: '%', decimals: 1 };
        flops = { raw_value: flops_val != null ? flops_val / 1e12 : null, unit: 'TFLOPs', decimals: 1 };
        flops_percentage = { raw_value: f_p, unit: '%', decimals: 1 };
        const shortName = (n: string) => ({ BFLOAT16: 'BF16', BFLOAT8_B: 'BFP8', BFLOAT4_B: 'BFP4' })[n] || n;

        if (math_fidelity) {
            math_fidelity_cell = {
                raw_value:
                    `${math_fidelity} ${shortName(input_0_datatype)} x ${shortName(input_1_datatype)} => ${shortName(output_datatype)}`.trim(),
            };
        }

        output_datatype_cell = { raw_value: output_datatype };
        input_0_datatype_cell = { raw_value: input_0_datatype };
        input_1_datatype_cell = { raw_value: input_1_datatype };
        is_dram_sharded_cell = { raw_value: is_dram_sharded };

        const attributes = String(row.ATTRIBUTES || '');
        const in0match = attributes.match(/in0_block_w=(\d+)/);
        if (in0match) {
            in0_block_w = { raw_value: Number(in0match[1]) };
        }
        const outHmatch = attributes.match(/out_subblock_h=(\d+)/);
        if (outHmatch) {
            out_subblock_h = { raw_value: Number(outHmatch[1]) };
        }
        const outWmatch = attributes.match(/out_subblock_w=(\d+)/);
        if (outWmatch) {
            out_subblock_w = { raw_value: Number(outWmatch[1]) };
        }

        const op_code = `${op_code_val} ${String(size)}`;

        return {
            ID: { raw_value: null },
            OP: { raw_value: null },
            'Total %': { raw_value: null },
            Bound: bound,
            'OP Code': { raw_value: op_code },
            'Device Time': { raw_value: row.device_time, unit: 'µs', decimals: 0 },
            'Op-to-Op Gap': { raw_value: row.op_to_op_gap, unit: 'µs', decimals: 0 },
            Cores: { raw_value: row.cores },
            DRAM: dram_speed,
            'DRAM %': dram_percentage,
            FLOPs: flops,
            'FLOPs %': flops_percentage,
            'Math Fidelity': math_fidelity_cell,
            'Output Datatype': output_datatype_cell,
            'Input 0 Datatype': input_0_datatype_cell,
            'Input 1 Datatype': input_1_datatype_cell,
            'DRAM Sharded': is_dram_sharded_cell,
            'Input 0 Memory': { raw_value: row.input_0_memory || null },
            'Inner Dim Block Size': in0_block_w,
            'Output Subblock H': out_subblock_h,
            'Output Subblock W': out_subblock_w,
        };
    }

    return {
        ID: { raw_value: null },
        OP: { raw_value: null },
        'Total %': { raw_value: null },
        Bound: bound,
        'OP Code': { raw_value: op_code_val },
        'Device Time': { raw_value: row.device_time || null, unit: 'µs', decimals: 0 },
        'Op-to-Op Gap': { raw_value: row.op_to_op_gap, unit: 'µs', decimals: 0 },
        Cores: { raw_value: row.cores || null },
        DRAM: dram_speed,
        'DRAM %': dram_percentage,
        FLOPs: flops,
        'FLOPs %': flops_percentage,
        'Math Fidelity': math_fidelity_cell,
        'Output Datatype': output_datatype_cell,
        'Input 0 Datatype': input_0_datatype_cell,
        'Input 1 Datatype': input_1_datatype_cell,
        'DRAM Sharded': is_dram_sharded_cell,
        'Input 0 Memory': { raw_value: row.input_0_memory || null },
        'Inner Dim Block Size': { raw_value: null },
        'Output Subblock H': { raw_value: null },
        'Output Subblock W': { raw_value: null },
    };
};

const formatCell = (row, header: TableHeader): React.JSX.Element | string => {
    const { key, unit, decimals, colour } = header;
    let formatted: string;

    // if (cell?.icon !== undefined) {
    //     return (
    //         <Tooltip content={cell.tooltip}>
    //             <Icon
    //                 color={cell.iconColor}
    //                 icon={cell.icon}
    //             />
    //         </Tooltip>
    //     );
    // }

    const value = row[key];

    if (value == null || value === '') {
        return '';
    }

    if (typeof value === 'string' && value.includes('Matmul')) {
        // there was a logic here to do something clever with Matmul size, removing it for now
        formatted = `${value}`;
    } else if (typeof value === 'number') {
        formatted = formatSize(Number(value.toFixed(decimals ?? 0)));
    } else {
        formatted = value;
    }

    if (unit) {
        formatted += ` ${unit}`;
    }

    return getCellMarkup(formatted, getCellColour(row, key));
};

const getCellMarkup = (text: string, color?: string) => {
    if (!text) {
        return text;
    }

    if (color) {
        return <span className={color}> {text}</span>;
    }

    return <span>{text}</span>;
};

const getCellColour = (row, key: string): CellColour | '' => {
    const keyValue = row[key];
    const percentage = row.total_percent;

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
        const match = Object.keys(OPERATION_COLOURS).find((opCodeKey) => keyValue.includes(opCodeKey));

        return match ? OPERATION_COLOURS[match] : 'white';
    }

    if (key === 'math_fidelity') {
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

    if (key === 'op_to_op_gap' && keyValue > 6.5) {
        return 'red';
    }

    // Shouldn't get to this point
    return 'grey';
};
