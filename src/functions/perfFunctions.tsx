// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

/* eslint camelcase: "off" */
import React from 'react';
import { Icon, Tooltip } from '@blueprintjs/core';
import { formatSize } from './math';
import { Cell, MathFidelity, ProcessedRow } from '../definitions/PerfTable';

const colored = (text: string, color?: string) => {
    if (!text) {
        return text;
    }
    if (color) {
        return <span className={color}> {text} </span>;
    }
    return <span>{text} </span>;
};
export const formatCell = (cell: Cell): React.JSX.Element | string => {
    if (cell.icon !== undefined) {
        return (
            <Tooltip content={cell.tooltip}>
                <Icon
                    color={cell.iconColor}
                    icon={cell.icon}
                />
            </Tooltip>
        );
    }

    if (cell.raw_value == null || cell.raw_value === '') {
        return '';
    }

    let formatted: string;
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
export const tflops_per_core = (math_fidelity: MathFidelity): number => {
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
export const get_datatype_size = (datatype: string): number => {
    const match = datatype.match(/\d+/);
    return match ? parseInt(match[0], 10) / 8 : 4;
};

export function evaluate_fidelity(
    input_0_datatype: string,
    input_1_datatype: string,
    output_datatype: string,
    math_fidelity: MathFidelity | '',
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

export const color_row = (op_data: ProcessedRow, min_percentage: number) => {
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
            const math_fidelity = parts[0] as MathFidelity;
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
