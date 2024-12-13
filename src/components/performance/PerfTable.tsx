// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

/* eslint camelcase: "off" */
import React, { FC, useMemo, useState } from 'react';
import '../../scss/components/PerfTable.scss';
import { Switch } from '@blueprintjs/core';
import { formatSize, toSecondsPretty } from '../../functions/math';

export interface RowData {
    [key: string]: string | number | null | undefined;
}

interface Cell {
    raw_value: string | number | null | undefined | boolean;
    unit?: string;
    decimals?: number;
    color?: string;
}

interface ProcessedRow {
    [key: string]: Cell;
}

// Utility functions
const colored = (text: string, color?: string) => {
    if (!text) {
        return text;
    }
    if (color) {
        return <span className={color}>{text}</span>;
    }
    return <span>{text}</span>;
};

const formatCell = (cell: Cell): React.JSX.Element | string => {
    if (cell.raw_value == null || cell.raw_value === '') {
        return '';
    }

    let formatted = '';
    if (typeof cell.raw_value === 'string' && cell.raw_value.includes('Matmul')) {
        // there was a logic here to do something clever with Matmul size, removing it for now
        formatted = `${cell.raw_value}`;
    } else if (typeof cell.raw_value === 'number') {
        const decimals = cell.decimals ?? 0;
        formatted = formatSize(Number(cell.raw_value.toFixed(decimals))); // cell.raw_value.toFixed(decimals);
    } else {
        formatted = String(cell.raw_value);
    }

    if (cell.unit) {
        formatted += ` ${cell.unit}`;
    }

    return colored(formatted, cell.color);
};

const tflops_per_core = (math_fidelity: string): number => {
    if (math_fidelity === 'HiFi4') {
        return 74 / 72;
    }
    if (math_fidelity === 'HiFi2') {
        return 148 / 72;
    }
    if (math_fidelity === 'LoFi') {
        return 262 / 72;
    }

    return 0;
    // throw new Error(`Unknown math fidelity: ${math_fidelity}`);
};

const get_datatype_size = (datatype: string): number => {
    const match = datatype.match(/\d+/);
    return match ? parseInt(match[0], 10) / 8 : 4;
};

function evaluate_fidelity(
    input_0_datatype: string,
    input_1_datatype: string,
    output_datatype: string,
    math_fidelity: string,
): [string, string | null] {
    const mantissa_bits: Record<string, number> = {
        BFLOAT16: 8,
        BFLOAT8_B: 7,
        BFLOAT4_B: 3,
    };

    const in0_bits = mantissa_bits[input_0_datatype];
    const in1_bits = mantissa_bits[input_1_datatype];
    const out_bits = mantissa_bits[output_datatype];

    if (in0_bits === 8 && out_bits >= 7) {
        if (math_fidelity === 'HiFi4') {
            return ['sufficient', 'HiFi2 may also work and has 2x the throughput of HiFi4'];
        }
        if (math_fidelity === 'HiFi2') {
            return ['too_low', 'If your matmuls are not FLOP-bound use HiFi4 with BF16 activations for full accuracy'];
        }
        if (math_fidelity === 'LoFi') {
            return ['too_low', 'Use HiFi2 or HiFi4 with BF16 activations for improved accuracy'];
        }
    } else if (in0_bits === 8 && out_bits === 3) {
        if (math_fidelity === 'HiFi4') {
            return ['too_high', 'HiFi2 is very likely to work for BFP8 output and has 2x the throughput of HiFi4'];
        }
        if (math_fidelity === 'HiFi2') {
            return ['sufficient', 'LoFi might also be sufficient with BFP4 output and has almost 2x the throughput'];
        }
        if (math_fidelity === 'LoFi') {
            return ['too_low', 'HiFi2 may give better accuracy for large matmuls with many intermediate accumulations'];
        }
    } else if (in1_bits >= 7 && out_bits >= 7) {
        if (math_fidelity === 'HiFi4') {
            return ['too_high', 'HiFi2 is sufficient for BFP8 multiplication and faster'];
        }
        if (math_fidelity === 'HiFi2') {
            return ['sufficient', null];
        }
        if (math_fidelity === 'LoFi') {
            return ['too_low', 'HiFi2 is recommended for accuracy; LoFi discards low bits of weights'];
        }
    } else if (in1_bits >= 7 && out_bits === 3) {
        if (math_fidelity === 'HiFi4') {
            return ['too_high', 'HiFi2 is sufficient and 2x throughput'];
        }
        if (math_fidelity === 'HiFi2') {
            return ['sufficient', 'LoFi might also be sufficient (BFP4 output) and has almost 2x throughput'];
        }
        if (math_fidelity === 'LoFi') {
            return ['too_low', 'HiFi2 may give slightly better accuracy for large matmuls'];
        }
    } else if (in1_bits === 3) {
        if (math_fidelity === 'LoFi') {
            return ['sufficient', null];
        }
        return ['too_high', 'LoFi is sufficient with BFP4 weights'];
    }
    return ['unknown', `Using ${math_fidelity} for ${input_0_datatype}/${input_1_datatype} => ${output_datatype}`];
}

// Analyze matmul similar to Python version (simplified)
const analyze_matmul = (row: RowData) => {
    const input_0_from_dram = String(row.INPUT_0_MEMORY || '').includes('DRAM');
    const input_1_from_dram = String(row.INPUT_1_MEMORY || '').includes('DRAM');

    let total_data_size_bytes = 0;

    const getVal = (key: string) => Number(row[key] || 0);

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
    const math_fidelity = String(row['MATH FIDELITY'] || '');

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

// Main analysis of ops
const analyze_op = (row: RowData, prevRow: RowData | null): ProcessedRow => {
    // to render device id if expanded multidevice
    // const device_id = row['DEVICE ID'];

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

    // console.log(op_to_op_latency_val);

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
            // core_count, /** not used atm */
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
        // Program config
        const attributes = String(row.ATTRIBUTES || '');
        // console.log(attributes);
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

        // Append size to OP Code
        const op_code = `${op_code_val} ${String(size)}`;

        return {
            ID: { raw_value: null },
            'Total %': { raw_value: null },
            Bound: bound,
            'OP Code': { raw_value: op_code },
            'Device Time': { raw_value: device_time_val, unit: 'µs', decimals: 0 },
            'Dispatch Time': { raw_value: dispatch_time_val, unit: 'µs', decimals: 0 },
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
        'Total %': { raw_value: null },
        Bound: bound,
        'OP Code': { raw_value: op_code_val },
        'Device Time': { raw_value: device_time_val || null, unit: 'µs', decimals: 0 },
        'Dispatch Time': { raw_value: dispatch_time_val, unit: 'µs', decimals: 0 },
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
            acc + ((r['Device Time'].raw_value as number) || 0) + ((r['Dispatch Time'].raw_value as number) || 0),
        0,
    );

    rows.forEach((r) => {
        const device_time = (r['Device Time'].raw_value as number) || 0;
        const dispatch_time = (r['Dispatch Time'].raw_value as number) || 0;
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

const getUniqueDeviceIDs = (rows: RowData[]): number[] => {
    const ids = new Set<number>();
    for (const row of rows) {
        if (row['DEVICE ID'] !== undefined) {
            ids.add(Number(row['DEVICE ID']));
        }
    }
    return Array.from(ids);
};

const color_row = (op_data: ProcessedRow, min_percentage: number) => {
    const percentage = op_data['Total %'].raw_value as number | null;

    if (percentage != null && percentage < min_percentage) {
        // grey out entire row
        // eslint-disable-next-line guard-for-in
        for (const k in op_data) {
            op_data[k].color = 'grey';
        }
    } else {
        const op_code_str = String(op_data['OP Code'].raw_value || '');
        const op_colors: { [key: string]: string } = {
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
        let matched = false;
        for (const o in op_colors) {
            if (op_code_str.includes(o)) {
                op_data['OP Code'].color = op_colors[o];
                matched = true;
                break;
            }
        }
        if (!matched) {
            op_data['OP Code'].color = 'white';
        }

        const num_cores = op_data.Cores.raw_value as number | null;
        if (num_cores != null) {
            if (num_cores < 10) {
                op_data.Cores.color = 'red';
            } else if (num_cores === 64) {
                op_data.Cores.color = 'green';
            }
        } else {
            op_data.Cores.color = 'grey';
        }

        const bound = String(op_data.Bound.raw_value || '');
        if (bound === 'DRAM') {
            op_data.Bound.color = 'green';
            op_data.DRAM.color = 'green';
            op_data['DRAM %'].color = 'green';
        } else if (bound === 'FLOP') {
            op_data.Bound.color = 'green';
            op_data.FLOPs.color = 'green';
            op_data['FLOPs %'].color = 'green';
        } else if (bound === 'SLOW') {
            op_data.Bound.color = 'yellow';
            const dram_p = op_data['DRAM %'].raw_value as number | null;
            const flops_p = op_data['FLOPs %'].raw_value as number | null;
            if (dram_p != null && flops_p != null) {
                if (dram_p > flops_p) {
                    op_data.DRAM.color = 'yellow';
                    op_data['DRAM %'].color = 'yellow';
                } else {
                    op_data.FLOPs.color = 'yellow';
                    op_data['FLOPs %'].color = 'yellow';
                }
            }
        } else if (bound === 'HOST') {
            op_data.Bound.color = 'red';
        }

        // Dispatch time >6.5us?
        const dispatch_time = op_data['Dispatch Time'].raw_value as number | null;
        if (dispatch_time != null && dispatch_time > 6.5) {
            op_data['Dispatch Time'].color = 'red';
        }

        // Math Fidelity evaluation
        if (op_code_str.includes('Matmul') && op_data['Math Fidelity'].raw_value) {
            const parts = String(op_data['Math Fidelity'].raw_value).split(' ');
            const math_fidelity = parts[0];
            const input_0_dt = String(op_data['Input 0 Datatype'].raw_value || '');
            const input_1_dt = String(op_data['Input 1 Datatype'].raw_value || '');
            const output_dt = String(op_data['Output Datatype'].raw_value || '');
            const [fidelity_eval] = evaluate_fidelity(input_0_dt, input_1_dt, output_dt, math_fidelity);
            if (fidelity_eval === 'sufficient') {
                op_data['Math Fidelity'].color = 'green';
            } else if (fidelity_eval === 'too_high') {
                op_data['Math Fidelity'].color = 'red';
            } else if (fidelity_eval === 'too_low') {
                op_data['Math Fidelity'].color = 'cyan';
            } else {
                op_data['Math Fidelity'].color = 'white';
            }
        }
    }
    return op_data;
};

// The main React component
interface PerformanceReportProps {
    data?: RowData[];
    minPercentage?: number;
}

export const PerformanceReport: FC<PerformanceReportProps> = ({ data, minPercentage = 0.5 }) => {
    const [deviceOpsCount, setDeviceOpsCount] = useState<number>(0);
    const [hostOpsCount, setHostOpsCount] = useState<number>(0);
    const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    const [showHostOps, setShowHostOps] = useState<boolean>(false);
    const [isMultiDevice, setIsMultiDevice] = useState<boolean>(false);
    const processedRows = useMemo(() => {
        if (data === undefined) {
            return [];
        }
        let df = data.slice();

        let deviceOps = 0;
        let hostOps = 0;
        df.forEach((r, index) => {
            r.ORIGINAL_ID = index + 2;
            if (String(r['OP CODE']).includes('(torch)') || String(r['OP CODE']) === '') {
                hostOps++;
            } else {
                deviceOps++;
            }
        });

        setHostOpsCount(hostOps);
        setDeviceOpsCount(deviceOps);

        // eslint-disable-next-line no-unused-expressions
        hostOpsCount;
        // eslint-disable-next-line no-unused-expressions
        deviceOpsCount;

        if (df.length > 0 && 'HOST START TS' in df[0]) {
            df = df.sort((a, b) => Number(a['HOST START TS'] || 0) - Number(b['HOST START TS'] || 0));
        }

        const uniqueDeviceIDs = getUniqueDeviceIDs(df);
        setIsMultiDevice(uniqueDeviceIDs.length > 1);
        if (uniqueDeviceIDs.length > 1 && mergeDeviceData) {
            // console.info(`Detected data from ${uniqueDeviceIDs.length} devices. Merging device data...`);
            df = mergeDeviceRows(df);
        }

        // Filter out host ops if we should
        if (!showHostOps) {
            df = df.filter((r) => !r['OP CODE']?.toString().includes('(torch)') && !(r['OP CODE']?.toString() === ''));
        }

        let rows: ProcessedRow[] = [];
        let prevRow: RowData | null = null;

        df.forEach((r) => {
            const opData = analyze_op(r, prevRow);
            // console.log(op_data);
            opData.ID.raw_value = String(r.ORIGINAL_ID);
            rows.push(opData);
            prevRow = r;
        });

        // console.log(df);

        add_derived_columns(rows);
        add_derived_columns(rows); // after any filtering if needed
        rows = rows.map((r) => color_row(r, minPercentage));

        return rows;
    }, [data, deviceOpsCount, hostOpsCount, mergeDeviceData, minPercentage, showHostOps]);

    const visibleHeaders = [
        'ID',
        'Total %',
        'Bound',
        'OP Code',
        'Device Time',
        'Dispatch Time',
        'Cores',
        'DRAM',
        'DRAM %',
        'FLOPs',
        'FLOPs %',
        'Math Fidelity',
    ];

    function mergeDeviceRows(rows: RowData[]): RowData[] {
        const blockByDevice: Record<number, Array<[string, RowData]>> = {};

        // Group rows by device ID for "tt_dnn_device" ops
        for (const row of rows) {
            const opType = String(row['OP TYPE'] || '');
            if (opType === 'tt_dnn_device') {
                const deviceId = Number(row['DEVICE ID']);
                if (!blockByDevice[deviceId]) {
                    blockByDevice[deviceId] = [];
                }
                const opName = String(row['OP CODE'] || '');
                blockByDevice[deviceId].push([opName, row]);
            }
        }

        const deviceIds = Object.keys(blockByDevice)
            .map(Number)
            .sort((a, b) => a - b);

        // Ensure all device arrays have the same length before zipping
        const lengths = deviceIds.map((did) => blockByDevice[did].length);
        const uniqueLengths = new Set(lengths);
        if (uniqueLengths.size > 1) {
            throw new Error('Inconsistent number of rows per device ID. Cannot merge.');
        }

        const mergedBlocks: RowData[] = [];
        const count = lengths[0]; // all have the same length

        for (let i = 0; i < count; i++) {
            const blocks = deviceIds.map((did) => blockByDevice[did][i]);
            // blocks is an array of tuples [opName, row] for each device at index i
            const opName = blocks[0][0];
            const isCollective = opName.includes('AllGather') || opName.includes('ReduceScatter');

            if (isCollective) {
                // For collective ops, pick minimum duration
                let minBlock = blocks[0];
                for (const blk of blocks) {
                    if (
                        Number(blk[1]['DEVICE FW DURATION [ns]'] || Infinity) <
                        Number(minBlock[1]['DEVICE FW DURATION [ns]'] || Infinity)
                    ) {
                        minBlock = blk;
                    }
                }
                mergedBlocks.push(minBlock[1]);
            } else {
                // For non-collective ops, pick maximum duration
                let maxBlock = blocks[0];
                for (const blk of blocks) {
                    if (
                        Number(blk[1]['DEVICE FW DURATION [ns]'] || -Infinity) >
                        Number(maxBlock[1]['DEVICE FW DURATION [ns]'] || -Infinity)
                    ) {
                        maxBlock = blk;
                    }
                }
                mergedBlocks.push(maxBlock[1]);
            }
        }

        return mergedBlocks;
    }

    const calcDispatchOps = (rows: ProcessedRow[]) => {
        const highDispatchOps = rows
            .map((op_data: ProcessedRow, idx: number) => [idx + 1, op_data] as [number, ProcessedRow])
            .filter(([_, op_data]) => {
                const val = op_data['Dispatch Time'].raw_value;
                return val !== null && val !== undefined && typeof val === 'number' && val > 100; // 6.5;
            });

        if (highDispatchOps.length === 0) {
            return null; // No high dispatch overhead ops, so no advice section
        }

        // Compute the max dispatch overhead
        const max_dispatch_overhead = highDispatchOps.reduce((acc, [_, op_data]) => {
            const val = op_data['Dispatch Time'].raw_value as number;
            return acc + (val - 6);
        }, 0);

        // Compute total_duration as sum of device times + dispatch times
        const total_device_time = rows.reduce((acc, r) => {
            const val = r['Device Time'].raw_value;
            return acc + (typeof val === 'number' ? val : 0);
        }, 0);
        const total_dispatch_time = rows.reduce((acc, r) => {
            const val = r['Dispatch Time'].raw_value;
            return acc + (typeof val === 'number' ? val : 0);
        }, 0);

        const total_duration = total_device_time + total_dispatch_time;
        const percentage_saved = (max_dispatch_overhead / total_duration) * 100;
        return (
            <div
                style={{ color: '#fff', marginTop: '1rem' }}
                className='perf-table'
            >
                <h4>High Dispatch Overhead</h4>
                <hr style={{ border: '1px solid #555', margin: '0.5rem 0' }} />

                <table
                    className='monospace'
                    style={{ borderCollapse: 'collapse', width: '100%', background: '#222' }}
                >
                    <thead>
                        <tr>
                            {visibleHeaders.map((h) => (
                                <th
                                    key={h}
                                    style={{ textAlign: 'left', borderBottom: '1px solid #555', padding: '0.25rem' }}
                                >
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {highDispatchOps.map(([rowIndex, op_data]) => (
                            <tr key={rowIndex}>
                                {visibleHeaders.map((h) => (
                                    <td
                                        key={h}
                                        style={{ borderBottom: '1px solid #333', padding: '0.25rem' }}
                                    >
                                        {formatCell(op_data[h])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>

                <p>
                    These ops have &gt; 6µs dispatch latency. Running with tracing could save{' '}
                    {formatSize(Number(max_dispatch_overhead.toFixed(0)))} µs {toSecondsPretty(max_dispatch_overhead)} (
                    {percentage_saved.toFixed(1)}% of overall time).
                </p>
                <p>Alternatively, try moving runtime args in the kernels to compile-time args.</p>
            </div>
        );
    };

    const calculateMatmul = (rows: ProcessedRow[]) => {
        const matmul_ops = rows.filter((op_data) => {
            const opCodeVal = op_data['OP Code'].raw_value;
            return typeof opCodeVal === 'string' && opCodeVal.includes('Matmul');
        });

        if (matmul_ops.length === 0) {
            return null; // No matmul ops, no advice
        }

        return (
            <div
                className='perf-table'
                style={{ color: '#fff', fontFamily: 'monospace', marginTop: '1rem' }}
            >
                <h3>Matmul Optimization</h3>
                <hr style={{ border: '1px solid #555', margin: '0.5rem 0' }} />

                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                        <tr>
                            {visibleHeaders.map((h) => (
                                <th
                                    key={h}
                                    style={{ textAlign: 'left', borderBottom: '1px solid #555', padding: '0.25rem' }}
                                >
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {matmul_ops.map((op_data: { [x: string]: Cell }, i: React.Key | null | undefined) => {
                            // Determine the color from OP Code
                            const opCodeColor = op_data['OP Code'].color === 'grey' ? 'grey' : 'white';

                            // Extract needed fields
                            const math_fidelity_raw = op_data['Math Fidelity'].raw_value;
                            const math_fidelity =
                                typeof math_fidelity_raw === 'string' ? math_fidelity_raw.split(' ')[0] : undefined;

                            const output_datatype = op_data['Output Datatype'].raw_value as string | undefined;
                            const input_0_datatype = op_data['Input 0 Datatype'].raw_value as string | undefined;
                            const input_1_datatype = op_data['Input 1 Datatype'].raw_value as string | undefined;
                            const cores = op_data.Cores.raw_value as number | undefined;
                            const fidelity_results = evaluate_fidelity(
                                input_0_datatype || '',
                                input_1_datatype || '',
                                output_datatype || '',
                                math_fidelity,
                            );
                            const [fidelity_evaluation, fidelity_advice] = fidelity_results;

                            const boundVal = op_data.Bound.raw_value as string | undefined;
                            const flops_pct = op_data['FLOPs %'].raw_value as number | undefined;
                            const dram_sharded = op_data['DRAM Sharded'].raw_value as boolean | undefined;
                            const input_0_memory = op_data['Input 0 Memory'].raw_value as string | undefined;
                            const inner_dim_block = op_data['Inner Dim Block Size'].raw_value as number | undefined;
                            const out_h = op_data['Output Subblock H'].raw_value as number | undefined;
                            const out_w = op_data['Output Subblock W'].raw_value as number | undefined;

                            // Compute advice lines
                            const advice: string[] = [];

                            if (boundVal === 'DRAM' || boundVal === 'BOTH') {
                                if (!dram_sharded) {
                                    advice.push(
                                        '- Try a DRAM-sharded program config (MatmulMultiCoreReuseMultiCastDRAMShardedProgramConfig) to improve throughput further',
                                    );
                                }
                                if (fidelity_evaluation === 'too_low' && flops_pct !== undefined && flops_pct < 40) {
                                    if (fidelity_advice) {
                                        advice.push(`- ${fidelity_advice}`);
                                    }
                                }
                                if (fidelity_evaluation === 'too_high' && fidelity_advice) {
                                    advice.push(`- ${fidelity_advice}`);
                                }
                            } else if (boundVal === 'FLOP' || boundVal === 'BOTH') {
                                if (cores !== undefined && cores < 64) {
                                    advice.push(`- Increase grid size (currently using ${cores})`);
                                }
                                if (fidelity_evaluation === 'too_high' && fidelity_advice) {
                                    advice.push(`- ${fidelity_advice}`);
                                }
                            } else if (boundVal === 'SLOW') {
                                if (input_0_memory && !input_0_memory.includes('L1')) {
                                    advice.push(`- If possible place input 0 in L1 (currently in ${input_0_memory})`);
                                }

                                let all_good = true;
                                if (inner_dim_block === undefined && out_h === undefined && out_w === undefined) {
                                    advice.push(
                                        '- No program_config specified, try using one to override in0_block_w and out_subblock_h/w',
                                    );
                                } else {
                                    if (inner_dim_block !== undefined) {
                                        if (inner_dim_block < 2) {
                                            advice.push(
                                                `- in0_block_w=${inner_dim_block} is small, try in0_block_w=2 or above`,
                                            );
                                            all_good = false;
                                        }
                                    } else {
                                        advice.push('- No inner dim block size found');
                                        all_good = false;
                                    }

                                    if (out_h !== undefined && out_w !== undefined) {
                                        const out_area = out_h * out_w;
                                        if (out_area < 2) {
                                            advice.push(
                                                `- Output subblock ${out_h}x${out_w} is small, try out_subblock_h * out_subblock_w >= 2 if possible`,
                                            );
                                            all_good = false;
                                        }
                                    } else {
                                        advice.push('- No output subblock size found');
                                        all_good = false;
                                    }

                                    if (all_good) {
                                        advice.push(
                                            `- in0_block_w=${inner_dim_block} and output subblock ${out_h}x${out_w} look good 🤷`,
                                        );
                                    }
                                    if (fidelity_advice) {
                                        advice.push(`- ${fidelity_advice}`);
                                    }
                                }
                            }

                            // If no advice, print "✅ Optimized"
                            const adviceContent =
                                advice.length > 0 ? (
                                    advice.map((item, idx) => (
                                        <div
                                            key={idx}
                                            style={{ color: opCodeColor }}
                                        >
                                            {item}
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ color: opCodeColor }}>✅ Optimized</div>
                                );

                            return (
                                <React.Fragment key={i}>
                                    <tr>
                                        {visibleHeaders.map((h) => (
                                            <td
                                                key={h}
                                                style={{ borderBottom: '1px solid #333', padding: '0.25rem' }}
                                            >
                                                {formatCell(op_data[h])}
                                            </td>
                                        ))}
                                    </tr>

                                    <tr>
                                        <td
                                            colSpan={visibleHeaders.length}
                                            style={{ padding: '0.5rem 0' }}
                                        >
                                            {adviceContent}
                                        </td>
                                    </tr>
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
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
                label={showHostOps ? 'Showing host ops' : 'Hiding host ops'}
                onChange={() => setShowHostOps(!showHostOps)}
                checked={showHostOps}
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
                        ))}
                    </tbody>
                </table>
            </div>
            <hr />
            {calcDispatchOps(processedRows)}
            <hr />
            {calculateMatmul(processedRows)}
        </>
    );
};
