// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from 'react';
import { Icon, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Link } from 'react-router-dom';
import { MathFidelity, TableHeader, TableKeys } from '../definitions/PerfTable';
import { OperationDescription } from '../model/APIData';
import { formatSize, toSecondsPretty } from './math';
import ROUTES from '../definitions/Routes';
import HighlightedText from '../components/HighlightedText';
import { TypedPerfTableRow } from './sortAndFilterPerfTableData';

type CellColour = 'white' | 'green' | 'red' | 'blue' | 'magenta' | 'cyan' | 'yellow' | 'orange' | 'grey';

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
    OptimizedConvNew: 'orange',
};

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

export const formatCell = (
    row: TypedPerfTableRow,
    header: TableHeader,
    operations?: OperationDescription[],
    highlight?: string | null,
): React.JSX.Element | string => {
    const { key, unit, decimals } = header;
    let formatted: string | boolean | string[];
    let value = row[key];

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

    if (key === 'op' && operations) {
        return (
            <Tooltip
                content={
                    <div className='op-tooltip'>
                        {value} {getOperationDetails(operations, value as number)}
                    </div>
                }
                usePortal={false}
            >
                <Link to={`${ROUTES.OPERATIONS}/${value}`}>{value}</Link>
            </Tooltip>
        );
    }

    if (NUMBER_KEYS_TO_PARSE.includes(key) && value) {
        value = typeof value === 'string' ? parseFloat(value) : value;
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

    return getCellMarkup(formatted, getCellColour(row, key), highlight);
};

export const getCellMarkup = (text: string, colour?: string, highlight?: string | null) => {
    if (!text) {
        return '';
    }

    if (highlight) {
        return (
            <HighlightedText
                className={colour}
                text={text}
                filter={highlight || ''}
            />
        );
    }

    if (colour) {
        return <span className={colour}>{text}</span>;
    }

    return <span>{text}</span>;
};

export const getCellColour = (row: TypedPerfTableRow, key: TableKeys): CellColour | '' => {
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
        const dramP = row.dram_percent;
        const flopsP = row.flops_percent;

        if (dramP != null && flopsP != null) {
            if (dramP > flopsP) {
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

    if (key === 'cores' && keyValue != null) {
        return getCoreColour(keyValue);
    }

    if (key === 'op_code') {
        const match = Object.keys(OPERATION_COLOURS).find((opCodeKey) => row.raw_op_code.includes(opCodeKey));

        return match ? OPERATION_COLOURS[match] : 'white';
    }

    if (key === 'math_fidelity' && typeof keyValue === 'string') {
        const parts = keyValue.split(' ');
        const mathFidelity = parts[0] as MathFidelity;
        const input0Datatype = row.input_0_datatype || '';
        const input1Datatype = row.input_1_datatype || '';
        const outputDatatype = row.output_datatype || '';
        const [fidelityEval] = evaluateFidelity(input0Datatype, input1Datatype, outputDatatype, mathFidelity);

        if (fidelityEval === 'sufficient') {
            return 'green';
        }

        if (fidelityEval === 'too_high') {
            return 'red';
        }

        if (fidelityEval === 'too_low') {
            return 'cyan';
        }

        return 'white';
    }

    if (key === 'op_to_op_gap' && typeof keyValue === 'string') {
        return getOpToOpGapColour(keyValue);
    }

    // Shouldn't get to this point but need to return something
    return 'grey';
};

export const getCoreColour = (value: string | string[] | boolean | number): CellColour | '' => {
    const cores = (typeof value === 'string' ? parseInt(value, 10) : value) as number;

    if (cores != null) {
        if (cores < 10) {
            return 'red';
        }

        if (cores === 64) {
            return 'green';
        }
    } else {
        return '';
    }

    return 'white';
};

export const getOpToOpGapColour = (value: string): CellColour | '' => {
    const parsedValue = parseFloat(value) || 0;

    return parsedValue > 6.5 ? 'red' : '';
};

export const calcHighDispatchOps = (rows: TypedPerfTableRow[]) => {
    const highDispatchOps = rows
        .map((opData: TypedPerfTableRow, index: number): [number, TypedPerfTableRow] => [index + 1, opData])
        .filter(([_, opData]) => {
            const val = opData.op_to_op_gap;
            return val !== null && val !== undefined && typeof val === 'number' && val > 6.5;
        });

    if (highDispatchOps.length === 0) {
        return null;
    }

    // Compute the max dispatch overhead
    const maxDispatchOverhead = highDispatchOps.reduce((acc, [_, opData]) => {
        const val = opData.op_to_op_gap || 0;

        return acc + (val - 6);
    }, 0);

    // Compute total_duration as sum of device times + Op-to-Op Gaps
    const totalDeviceTime = rows.reduce((acc, r) => {
        const val = r.device_time || 0;

        return acc + (typeof val === 'number' ? val : 0);
    }, 0);

    const totalDispatchTime = rows.reduce((acc, r) => {
        const val = r.op_to_op_gap;

        return acc + (typeof val === 'number' ? val : 0);
    }, 0);

    const totalDuration = totalDeviceTime + totalDispatchTime;
    const percentageSaved = (maxDispatchOverhead / totalDuration) * 100;

    return (
        <div>
            <p>
                Marked ops have &gt; 6µs dispatch latency. Running with tracing could save{' '}
                {formatSize(Number(maxDispatchOverhead.toFixed(0)))} µs {toSecondsPretty(maxDispatchOverhead)} (
                {percentageSaved.toFixed(1)}% of overall time).
            </p>
            <p>Alternatively, try moving runtime args in the kernels to compile-time args.</p>
        </div>
    );
};

export function evaluateFidelity(
    input0Datatype: string,
    input1Datatype: string,
    outputDatatype: string,
    mathFidelity: MathFidelity | '',
): [string, string | null] {
    const mantissaBits: Record<string, number> = {
        BFLOAT16: 8,
        BFLOAT8_B: 7,
        BFLOAT4_B: 3,
    };

    const in0Bits = mantissaBits[input0Datatype];
    const in1Bits = mantissaBits[input1Datatype];
    const outBits = mantissaBits[outputDatatype];

    // I note that we're not using the second part of the returned array, only the first part.
    if (in0Bits === 8 && outBits >= 7) {
        if (mathFidelity === 'HiFi4') {
            return ['sufficient', 'HiFi2 may also work and has 2x the throughput of HiFi4'];
        }

        if (mathFidelity === 'HiFi2') {
            return ['too_low', 'If your matmuls are not FLOP-bound use HiFi4 with BF16 activations for full accuracy'];
        }

        if (mathFidelity === 'LoFi') {
            return ['too_low', 'Use HiFi2 or HiFi4 with BF16 activations for improved accuracy'];
        }
    } else if (in0Bits === 8 && outBits === 3) {
        if (mathFidelity === 'HiFi4') {
            return ['too_high', 'HiFi2 is very likely to work for BFP8 output and has 2x the throughput of HiFi4'];
        }

        if (mathFidelity === 'HiFi2') {
            return ['sufficient', 'LoFi might also be sufficient with BFP4 output and has almost 2x the throughput'];
        }

        if (mathFidelity === 'LoFi') {
            return ['too_low', 'HiFi2 may give better accuracy for large matmuls with many intermediate accumulations'];
        }
    } else if (in1Bits >= 7 && outBits >= 7) {
        if (mathFidelity === 'HiFi4') {
            return ['too_high', 'HiFi2 is sufficient for BFP8 multiplication and faster'];
        }

        if (mathFidelity === 'HiFi2') {
            return ['sufficient', null];
        }

        if (mathFidelity === 'LoFi') {
            return ['too_low', 'HiFi2 is recommended for accuracy; LoFi discards low bits of weights'];
        }
    } else if (in1Bits >= 7 && outBits === 3) {
        if (mathFidelity === 'HiFi4') {
            return ['too_high', 'HiFi2 is sufficient and 2x throughput'];
        }

        if (mathFidelity === 'HiFi2') {
            return ['sufficient', 'LoFi might also be sufficient (BFP4 output) and has almost 2x throughput'];
        }

        if (mathFidelity === 'LoFi') {
            return ['too_low', 'HiFi2 may give slightly better accuracy for large matmuls'];
        }
    } else if (in1Bits === 3) {
        if (mathFidelity === 'LoFi') {
            return ['sufficient', null];
        }
        return ['too_high', 'LoFi is sufficient with BFP4 weights'];
    }

    return ['unknown', `Using ${mathFidelity} for ${input0Datatype}/${input1Datatype} => ${outputDatatype}`];
}

export function getOperationDetails(operations: OperationDescription[], id: number) {
    const matchingOp = operations?.find((op) => op.id === id);

    return matchingOp ? `${matchingOp.name} (${matchingOp.operationFileIdentifier})` : '';
}

export function getAxisUpperRange(arrays: Array<unknown[]>): number {
    // Adds + 1 to avoid cutting off the last plotted element in some cases and to create some space on the right side of the chart data
    return Math.max(...arrays.map((arr) => arr.length), 0) + 1;
}
