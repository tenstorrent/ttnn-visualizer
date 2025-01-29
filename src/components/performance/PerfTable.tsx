// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

/* eslint camelcase: "off" */
import React, { FC, useMemo, useState } from 'react';
import '../../scss/components/PerfTable.scss';
import { Switch } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { formatSize, toSecondsPretty } from '../../functions/math';
import {
    color_row,
    evaluate_fidelity,
    formatCell,
    getUniqueDeviceIDs,
    get_datatype_size,
    mergeMultideviceRows,
    tflops_per_core,
} from '../../functions/perfFunctions';
import { Cell, MathFidelity, ProcessedRow, RowData } from '../../definitions/PerfTable';
import { useOptoPerfIdFiltered } from '../../hooks/useAPI';

const analyze_matmul = (row: RowData) => {
    const input_0_from_dram = String(row.INPUT_0_MEMORY || '').includes('DRAM');
    const input_1_from_dram = String(row.INPUT_1_MEMORY || '').includes('DRAM');

    let total_data_size_bytes = 0;

    const getVal = (key: keyof RowData) => Number(row[key] || 0);

    if (input_0_from_dram) {
        total_data_size_bytes +=
            getVal('INPUT_0_W') *
            getVal('INPUT_0_Y') *
            getVal('INPUT_0_Z') *
            getVal('INPUT_0_X') *
            get_datatype_size(String(row.INPUT_0_DATATYPE));
    }
    if (input_1_from_dram) {
        total_data_size_bytes +=
            getVal('INPUT_1_W') *
            getVal('INPUT_1_Y') *
            getVal('INPUT_1_Z') *
            getVal('INPUT_1_X') *
            get_datatype_size(String(row.INPUT_1_DATATYPE));
    }

    if (String(row.OUTPUT_0_MEMORY || '').includes('DRAM')) {
        total_data_size_bytes +=
            getVal('OUTPUT_0_W') *
            getVal('OUTPUT_0_Y') *
            getVal('OUTPUT_0_Z') *
            getVal('OUTPUT_0_X') *
            get_datatype_size(String(row.OUTPUT_0_DATATYPE));
    }

    const duration_s = Number(row['DEVICE KERNEL DURATION [ns]'] || 0) * 1e-9;
    const dram_speed_gb_s =
        total_data_size_bytes > 0 && duration_s > 0 ? total_data_size_bytes / duration_s / 1e9 : null;

    let core_count = getVal('CORE COUNT');
    const math_fidelity = String(row['MATH FIDELITY'] || '') as MathFidelity;

    const attributes = String(row.ATTRIBUTES || '');
    const is_dram_sharded = attributes.includes('MatmulMultiCoreReuseMultiCastDRAMShardedProgramConfig');
    if (is_dram_sharded) {
        core_count = 12;
    }

    const peak_flops_value = tflops_per_core(math_fidelity) * 1e12 * core_count;

    const M = getVal('INPUT_0_Y');
    const K = getVal('INPUT_0_X');
    const N = getVal('INPUT_1_X');
    const W = getVal('INPUT_0_W');
    const Z = getVal('INPUT_0_Z');

    const flops_val = duration_s > 0 ? (M * K * N * W * Z * 2) / duration_s : null;

    const size = `${M} x ${K} x ${N}`;
    const memory_info = `(${row.INPUT_0_DATATYPE} ${String(row.INPUT_0_MEMORY || '').replace('DEV_0_', '')} @ ${row.INPUT_1_DATATYPE} ${String(row.INPUT_1_MEMORY || '').replace('DEV_0_', '')} => ${row.OUTPUT_0_DATATYPE} ${String(row.OUTPUT_0_MEMORY || '').replace('DEV_0_', '')})`;

    const dram_percentage = dram_speed_gb_s != null ? (dram_speed_gb_s / 288) * 100 : null;
    const flops_percentage = flops_val != null ? (flops_val / peak_flops_value) * 100 : null;

    return {
        dram_speed_gb_s,
        dram_percentage,
        flops_val,
        flops_percentage,
        size,
        memory_info,
        math_fidelity,
        is_dram_sharded,
        input_0_datatype: String(row.INPUT_0_DATATYPE || ''),
        input_1_datatype: String(row.INPUT_1_DATATYPE || ''),
        output_datatype: String(row.OUTPUT_0_DATATYPE || ''),
        core_count,
    };
};

const analyze_op = (row: RowData, prevRow: RowData | null): ProcessedRow => {
    const op_code_val = String(row['OP CODE'] || '');
    const device_time_val = (Number(row['DEVICE FW DURATION [ns]']) || 0) / 1000;
    let dispatch_time_val: number | null = null;
    if (prevRow && prevRow['OP TO OP LATENCY [ns]'] != null) {
        dispatch_time_val = (Number(row['OP TO OP LATENCY [ns]']) || 0) / 1000;
    }

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
            'Device Time': { raw_value: device_time_val, unit: 'µs', decimals: 0 },
            'Op-to-Op Gap': { raw_value: dispatch_time_val, unit: 'µs', decimals: 0 },
            Cores: { raw_value: Number(row['CORE COUNT']) },
            DRAM: dram_speed,
            'DRAM %': dram_percentage,
            FLOPs: flops,
            'FLOPs %': flops_percentage,
            'Math Fidelity': math_fidelity_cell,
            'Output Datatype': output_datatype_cell,
            'Input 0 Datatype': input_0_datatype_cell,
            'Input 1 Datatype': input_1_datatype_cell,
            'DRAM Sharded': is_dram_sharded_cell,
            'Input 0 Memory': { raw_value: row.INPUT_0_MEMORY || null },
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
        'Device Time': { raw_value: device_time_val || null, unit: 'µs', decimals: 0 },
        'Op-to-Op Gap': { raw_value: dispatch_time_val, unit: 'µs', decimals: 0 },
        Cores: { raw_value: Number(row['CORE COUNT']) || null },
        DRAM: dram_speed,
        'DRAM %': dram_percentage,
        FLOPs: flops,
        'FLOPs %': flops_percentage,
        'Math Fidelity': math_fidelity_cell,
        'Output Datatype': output_datatype_cell,
        'Input 0 Datatype': input_0_datatype_cell,
        'Input 1 Datatype': input_1_datatype_cell,
        'DRAM Sharded': is_dram_sharded_cell,
        'Input 0 Memory': { raw_value: row.INPUT_0_MEMORY || null },
        'Inner Dim Block Size': { raw_value: null },
        'Output Subblock H': { raw_value: null },
        'Output Subblock W': { raw_value: null },
    };
};

const add_derived_columns = (rows: ProcessedRow[]) => {
    const total_duration = rows.reduce(
        (acc, r) =>
            acc + ((r['Device Time'].raw_value as number) || 0) + ((r['Op-to-Op Gap'].raw_value as number) || 0),
        0,
    );

    rows.forEach((r) => {
        const device_time = (r['Device Time'].raw_value as number) || 0;
        const dispatch_time = (r['Op-to-Op Gap'].raw_value as number) || 0;
        if (total_duration > 0) {
            r['Total %'] = {
                raw_value: ((device_time + dispatch_time) / total_duration) * 100,
                unit: '%',
                decimals: 1,
            };
        } else {
            r['Total %'] = { raw_value: null };
        }

        const dram_percentage = r['DRAM %'].raw_value as number | null;
        const flops_percentage = r['FLOPs %'].raw_value as number | null;
        if (r['OP Code'].raw_value && String(r['OP Code'].raw_value).includes('Matmul')) {
            if (dram_percentage != null && flops_percentage != null) {
                if (dram_percentage >= 65 && flops_percentage >= 65) {
                    r.Bound = { raw_value: 'BOTH' };
                } else if (dram_percentage >= 65) {
                    r.Bound = { raw_value: 'DRAM' };
                } else if (flops_percentage >= 65) {
                    r.Bound = { raw_value: 'FLOP' };
                } else {
                    r.Bound = { raw_value: 'SLOW' };
                }
            }
        } else if (r['OP Code'].raw_value && String(r['OP Code'].raw_value).includes('(torch)')) {
            r.Bound = { raw_value: 'HOST' };
        }
    });
};

// The main React component
interface PerformanceReportProps {
    data?: RowData[];
    minPercentage?: number;
}

export const PerformanceReport: FC<PerformanceReportProps> = ({ data, minPercentage = 0.5 }) => {
    const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    const [showHostOps, setShowHostOps] = useState<boolean>(false);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState<boolean>(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState<boolean>(false);
    const [isMultiDevice, setIsMultiDevice] = useState<boolean>(false);
    const opIdsMap = useOptoPerfIdFiltered();
    console.log('PERF:', opIdsMap);
    // console.log(
    //     '2',
    //     opIdsMap.find((op) => Number(op.perfId) === 2),
    // );

    const processedRows = useMemo(() => {
        if (data === undefined) {
            return [];
        }
        console.log('PERF memo:', opIdsMap);
        let df = data.slice();

        df.forEach((r, index) => {
            r.ORIGINAL_ID = index + 2;
        });

        if (df.length > 0 && 'HOST START TS' in df[0]) {
            df = df.sort((a, b) => Number(a['HOST START TS'] || 0) - Number(b['HOST START TS'] || 0));
        }

        const uniqueDeviceIDs = getUniqueDeviceIDs(df);
        setIsMultiDevice(uniqueDeviceIDs.length > 1);
        if (uniqueDeviceIDs.length > 1 && mergeDeviceData) {
            // console.info(`Detected data from ${uniqueDeviceIDs.length} devices. Merging device data...`);
            df = mergeMultideviceRows(df);
        }

        // Filter out host ops if we should
        if (!showHostOps) {
            df = df.filter((r) => !r['OP CODE']?.toString().includes('(torch)') && !(r['OP CODE']?.toString() === ''));
        }

        let rows: ProcessedRow[] = [];
        let prevRow: RowData | null = null;

        df.forEach((r) => {
            const opData = analyze_op(r, prevRow);
            const linkedObj = opIdsMap.find((op) => op.perfId === r.ORIGINAL_ID);
            opData.ID.raw_value = String(r.ORIGINAL_ID);
            opData.OP.raw_value = linkedObj?.opId || null;
            rows.push(opData);
            prevRow = r;
        });

        add_derived_columns(rows);
        rows = rows.map((r) => color_row(r, minPercentage));

        if (hiliteHighDispatch) {
            rows.forEach((op_data: ProcessedRow) => {
                const val = op_data['Op-to-Op Gap'].raw_value;
                const highDispatch = val !== null && val !== undefined && typeof val === 'number' && val > 6.5;
                op_data.Slow = {
                    raw_value: null,
                    icon: highDispatch ? IconNames.WARNING_SIGN : undefined,
                    tooltip: highDispatch ? 'Op with > 6µs dispatch latency' : undefined,
                    iconColor: '#ff0',
                };
            });
        }

        return rows;
    }, [data, opIdsMap, mergeDeviceData, showHostOps, hiliteHighDispatch, minPercentage]);

    const baseHeaders = [
        'ID',
        'OP',
        'Total %',
        'Bound',
        'OP Code',
        'Device Time',
        'Op-to-Op Gap',
        'Cores',
        'DRAM',
        'DRAM %',
        'FLOPs',
        'FLOPs %',
        'Math Fidelity',
    ];
    const visibleHeaders = hiliteHighDispatch
        ? [...baseHeaders.slice(0, 5), 'Slow', ...baseHeaders.slice(5)]
        : baseHeaders;

    const calcDispatchOps = (rows: ProcessedRow[]) => {
        const highDispatchOps = rows
            .map((op_data: ProcessedRow, idx: number) => [idx + 1, op_data] as [number, ProcessedRow])
            .filter(([_, op_data]) => {
                const val = op_data['Op-to-Op Gap'].raw_value;
                return val !== null && val !== undefined && typeof val === 'number' && val > 6.5;
            });

        if (highDispatchOps.length === 0) {
            return null; // No high dispatch overhead ops, so no advice section
        }

        // Compute the max dispatch overhead
        const max_dispatch_overhead = highDispatchOps.reduce((acc, [_, op_data]) => {
            const val = op_data['Op-to-Op Gap'].raw_value as number;
            return acc + (val - 6);
        }, 0);

        // Compute total_duration as sum of device times + Op-to-Op Gaps
        const total_device_time = rows.reduce((acc, r) => {
            const val = r['Device Time'].raw_value;
            return acc + (typeof val === 'number' ? val : 0);
        }, 0);
        const total_dispatch_time = rows.reduce((acc, r) => {
            const val = r['Op-to-Op Gap'].raw_value;
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
                label={showHostOps ? 'Hide host ops' : 'Show host ops'}
                onChange={() => setShowHostOps(!showHostOps)}
                checked={showHostOps}
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
                                    key={h}
                                    style={{ textAlign: 'left', borderBottom: '1px solid #555' }}
                                >
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {processedRows.map((row, i) => (
                            <React.Fragment key={i}>
                                <tr key={i}>
                                    {visibleHeaders.map((h) => (
                                        <td
                                            key={h}
                                            style={{ borderBottom: '1px solid #333', padding: '0.25rem' }}
                                        >
                                            {formatCell(row[h])}
                                        </td>
                                    ))}
                                </tr>
                                {provideMatmulAdvice && row['OP Code'].raw_value?.toString().includes('Matmul') && (
                                    <MatmulAdvice
                                        key={`matmul-advice-${i}`}
                                        row={row}
                                        colSpan={visibleHeaders.length}
                                    />
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
            <hr />
            {hiliteHighDispatch && calcDispatchOps(processedRows)}
        </>
    );
};
const MatmulAdvice: FC<{ row: ProcessedRow; colSpan: number }> = ({ row, colSpan }) => {
    const getMatmulOptimizationAdvice = (op_data: ProcessedRow) => {
        const opCodeColor = op_data['OP Code'].color === 'grey' ? 'grey' : 'white';

        // Extract needed fields
        const math_fidelity_raw = op_data['Math Fidelity'].raw_value;
        const math_fidelity =
            typeof math_fidelity_raw === 'string' ? (math_fidelity_raw.split(' ')[0] as MathFidelity) : undefined;

        const output_datatype = op_data['Output Datatype'].raw_value as string | undefined;
        const input_0_datatype = op_data['Input 0 Datatype'].raw_value as string | undefined;
        const input_1_datatype = op_data['Input 1 Datatype'].raw_value as string | undefined;
        const cores = op_data.Cores.raw_value as number | undefined;
        const fidelity_results = evaluate_fidelity(
            input_0_datatype || '',
            input_1_datatype || '',
            output_datatype || '',
            math_fidelity || '',
        );
        const [fidelity_evaluation, fidelity_advice] = fidelity_results;

        const boundVal = op_data.Bound.raw_value as string | null;
        const flops_pct = op_data['FLOPs %'].raw_value as number | null;
        const dram_sharded = op_data['DRAM Sharded'].raw_value as boolean | null;
        const input_0_memory = op_data['Input 0 Memory'].raw_value as string | null;
        const inner_dim_block = op_data['Inner Dim Block Size'].raw_value as number | null;
        const out_h = op_data['Output Subblock H'].raw_value as number | null;
        const out_w = op_data['Output Subblock W'].raw_value as number | null;

        // Compute advice lines
        const advice: string[] = [];

        if (boundVal === 'DRAM' || boundVal === 'BOTH') {
            if (!dram_sharded) {
                advice.push(
                    'Try a DRAM-sharded program config (MatmulMultiCoreReuseMultiCastDRAMShardedProgramConfig) to improve throughput further',
                );
            }
            if (fidelity_evaluation === 'too_low' && flops_pct !== null && flops_pct < 40) {
                if (fidelity_advice) {
                    advice.push(`${fidelity_advice}`);
                }
            }
            if (fidelity_evaluation === 'too_high' && fidelity_advice) {
                advice.push(`${fidelity_advice}`);
            }
        } else if (boundVal === 'FLOP' || boundVal === 'BOTH') {
            if (cores !== undefined && cores < 64) {
                advice.push(`Increase grid size (currently using ${cores})`);
            }
            if (fidelity_evaluation === 'too_high' && fidelity_advice) {
                advice.push(`${fidelity_advice}`);
            }
        } else if (boundVal === 'SLOW') {
            if (input_0_memory && !input_0_memory.includes('L1')) {
                advice.push(`If possible place input 0 in L1 (currently in ${input_0_memory})`);
            }

            let all_good = true;
            if (inner_dim_block === null && out_h === null && out_w === null) {
                advice.push('No program_config specified, try using one to override in0_block_w and out_subblock_h/w');
            } else {
                if (inner_dim_block !== null) {
                    if (inner_dim_block < 2) {
                        advice.push(`in0_block_w=${inner_dim_block} is small, try in0_block_w=2 or above`);
                        all_good = false;
                    }
                } else {
                    advice.push('No inner dim block size found');
                    all_good = false;
                }

                if (out_h !== null && out_w !== null) {
                    const out_area = out_h * out_w;
                    if (out_area < 2) {
                        advice.push(
                            `Output subblock ${out_h}x${out_w} is small, try out_subblock_h * out_subblock_w >= 2 if possible`,
                        );
                        all_good = false;
                    }
                } else {
                    advice.push('No output subblock size found');
                    all_good = false;
                }

                if (all_good) {
                    advice.push(`in0_block_w=${inner_dim_block} and output subblock ${out_h}x${out_w} look good 🤷`);
                }
                if (fidelity_advice) {
                    advice.push(`${fidelity_advice}`);
                }
            }
        }

        return advice.length > 0 ? (
            <ul>
                {advice.map((item, idx) => (
                    <li
                        key={idx}
                        style={{ paddingLeft: '1rem', color: opCodeColor }}
                    >
                        {item}
                    </li>
                ))}
            </ul>
        ) : (
            <ul>
                <li
                    key={1}
                    style={{ color: opCodeColor }}
                >
                    ✅ Optimized
                </li>
            </ul>
        );
    };
    return (
        <tr>
            <td
                colSpan={colSpan}
                style={{ padding: '0.25rem' }}
            >
                {getMatmulOptimizationAdvice(row)}
            </td>
        </tr>
    );
};
