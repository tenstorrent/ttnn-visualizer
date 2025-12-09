// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import { Icon, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Link } from 'react-router-dom';
import {
    BoundType,
    ColumnHeaders,
    MathFidelity,
    TableHeader,
    TableKeys,
    TypedPerfTableRow,
} from '../definitions/PerfTable';
import { OperationDescription } from '../model/APIData';
import { formatPercentage, formatSize, toSecondsPretty } from './math';
import ROUTES from '../definitions/Routes';
import HighlightedText from '../components/HighlightedText';
import { OpType } from '../definitions/Performance';
import { TypedStackedPerfRow } from '../definitions/StackedPerfTable';
import { NormalisedPerfData } from './normalisePerformanceData';
import { BufferTypeLabel } from '../model/BufferType';

export enum CellColour {
    White = 'white',
    Green = 'green',
    Red = 'red',
    Blue = 'blue',
    Magenta = 'magenta',
    Cyan = 'cyan',
    Yellow = 'yellow',
    Orange = 'orange',
    Grey = 'grey',
}

export interface Signpost {
    id: number;
    op_code: string;
}

const OPERATION_COLOURS: { [key: string]: CellColour } = {
    '(torch)': CellColour.Red,
    Matmul: CellColour.Magenta,
    LayerNorm: CellColour.Cyan,
    AllGather: CellColour.Cyan,
    AllReduce: CellColour.Cyan,
    ScaledDotProductAttentionDecode: CellColour.Blue,
    ScaledDotProductAttentionGQADecode: CellColour.Blue,
    NlpCreateHeadsDeviceOperation: CellColour.Blue,
    NLPConcatHeadsDecodeDeviceOperation: CellColour.Blue,
    UpdateCache: CellColour.Blue,
    OptimizedConvNew: CellColour.Orange, // Deprecated - Conv2d is the new name for this operation
    Conv2d: CellColour.Orange,
};

const DEFAULT_COLOUR = CellColour.White;
const FALLBACK_COLOUR = CellColour.Grey;
const WARNING_COLOUR = CellColour.Yellow;

const MIN_PERCENTAGE = 0.5;

// TODO: Check if we still need this formatting step because we're using typed data
export const formatCell = (
    row: TypedPerfTableRow,
    header: TableHeader,
    operations?: OperationDescription[],
    highlight?: string | null,
): React.JSX.Element | string => {
    const { key, unit, decimals } = header;
    const isSignpost = row.op_type === OpType.SIGNPOST;
    const isHost = isHostOp(row.bound);
    let formatted: string | boolean | string[];
    let value = row[key];

    if (value === null || value === '' || Number.isNaN(value)) {
        return '';
    }

    if (isSignpost) {
        // Signposts only have a few meaningful columns
        if (key !== ColumnHeaders.id && key !== ColumnHeaders.op_code) {
            return '';
        }

        value = value !== null ? String(value) : '';
    }

    if (isHost) {
        // Host Ops only have a few meaningful columns
        if (key !== ColumnHeaders.id && key !== ColumnHeaders.op_code && key !== ColumnHeaders.bound) {
            return '';
        }
    }

    if (key === ColumnHeaders.buffer_type) {
        return BufferTypeLabel[value as number];
    }

    if (key === ColumnHeaders.high_dispatch) {
        return (
            <Tooltip content='Op with > 6 µs dispatch latency'>
                <Icon
                    className={WARNING_COLOUR}
                    icon={IconNames.WARNING_SIGN}
                    title='Op with > 6 µs dispatch latency'
                />
            </Tooltip>
        );
    }

    if (key === ColumnHeaders.OP && operations) {
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

    if (typeof value === 'number') {
        formatted = formatSize(value, decimals);
    } else {
        formatted = value.toString();
    }

    if (unit) {
        formatted += ` ${unit}`;
    }

    return getCellMarkup(formatted, getCellColour(row, key), highlight);
};

export const getCellMarkup = (text: string, colour?: CellColour, highlight?: string | null) => {
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

export const getCellColour = (row: TypedPerfTableRow, key: TableKeys): CellColour => {
    const keyValue = row[key];
    const percentage = row.total_percent;

    if (percentage != null && percentage < MIN_PERCENTAGE) {
        return FALLBACK_COLOUR;
    }

    if (row.op_type === OpType.SIGNPOST) {
        return DEFAULT_COLOUR;
    }

    if (key === ColumnHeaders.id || key === ColumnHeaders.total_percent || key === ColumnHeaders.device_time) {
        return DEFAULT_COLOUR;
    }

    if (key === ColumnHeaders.bound) {
        if (keyValue === BoundType.HOST) {
            return CellColour.Green;
        }

        if (keyValue === BoundType.FLOP) {
            return CellColour.Green;
        }

        if (keyValue === BoundType.SLOW) {
            return CellColour.Yellow;
        }

        if (keyValue === BoundType.DRAM) {
            return CellColour.Green;
        }
    }

    if (
        key === ColumnHeaders.dram ||
        key === ColumnHeaders.dram_percent ||
        key === ColumnHeaders.flops ||
        key === ColumnHeaders.flops_percent
    ) {
        if (row.bound === BoundType.DRAM) {
            if (key === ColumnHeaders.dram || key === ColumnHeaders.dram_percent) {
                return CellColour.Green;
            }
        }

        if (row.bound === BoundType.FLOP) {
            if (key === ColumnHeaders.flops || key === ColumnHeaders.flops_percent) {
                return CellColour.Green;
            }
        }

        if (row.bound === BoundType.HOST) {
            return CellColour.Red;
        }

        const dramP = row.dram_percent;
        const flopsP = row.flops_percent;

        if (row.bound === BoundType.SLOW) {
            if (dramP != null && flopsP != null) {
                if (dramP > flopsP) {
                    if (key === ColumnHeaders.dram || key === ColumnHeaders.dram_percent) {
                        return CellColour.Yellow;
                    }
                } else if (key === ColumnHeaders.flops || key === ColumnHeaders.flops_percent) {
                    return CellColour.Yellow;
                }
            }
        }

        return DEFAULT_COLOUR;
    }

    if (key === ColumnHeaders.cores && keyValue != null) {
        return getCoreColour(keyValue);
    }

    if (key === ColumnHeaders.op_code) {
        const match = Object.keys(OPERATION_COLOURS).find((opCodeKey) => row.raw_op_code.includes(opCodeKey));

        return match ? OPERATION_COLOURS[match] : DEFAULT_COLOUR;
    }

    if (key === ColumnHeaders.math_fidelity && typeof keyValue === 'string') {
        const parts = keyValue.split(' ');
        const mathFidelity = parts[0] as MathFidelity;
        const input0Datatype = row.input_0_datatype || '';
        const input1Datatype = row.input_1_datatype || '';
        const outputDatatype = row.output_datatype || '';
        const [fidelityEval] = evaluateFidelity(input0Datatype, input1Datatype, outputDatatype, mathFidelity);

        if (fidelityEval === 'sufficient') {
            return CellColour.Green;
        }

        if (fidelityEval === 'too_high') {
            return CellColour.Red;
        }

        if (fidelityEval === 'too_low') {
            return CellColour.Cyan;
        }

        return DEFAULT_COLOUR;
    }

    if (key === ColumnHeaders.op_to_op_gap) {
        return typeof keyValue === 'number' ? getOpToOpGapColour(keyValue) : FALLBACK_COLOUR;
    }

    // Shouldn't get to this point but need to return something
    return FALLBACK_COLOUR;
};

export const getCoreColour = (value: string | string[] | boolean | number): CellColour => {
    const cores = (typeof value === 'string' ? parseInt(value, 10) : value) as number;

    if (cores != null) {
        if (cores < 10) {
            return CellColour.Red;
        }

        if (cores === 64) {
            return CellColour.Green;
        }
    }

    return DEFAULT_COLOUR;
};

export const getOpToOpGapColour = (value: number): CellColour => {
    return value > 6.5 ? CellColour.Red : FALLBACK_COLOUR;
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
        <div className='high-dispatch-advice'>
            <p>
                Marked ops have &gt; 6 µs dispatch latency. Running with tracing could save{' '}
                {formatSize(maxDispatchOverhead, 0)} µs {toSecondsPretty(maxDispatchOverhead)} (
                {formatPercentage(percentageSaved, 1)} of overall time).
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
        FLOAT32: 23,
        BFLOAT16: 8,
        BFLOAT8_B: 7,
        BFLOAT4_B: 3,
    };

    const in0Bits = mantissaBits[input0Datatype];
    const in1Bits = mantissaBits[input1Datatype];
    const outBits = mantissaBits[outputDatatype];

    // I note that we're not using the second part of the returned array, only the first part.
    if (in0Bits === 8 && outBits >= 7) {
        if (mathFidelity === MathFidelity.HiFi4) {
            return ['sufficient', 'HiFi2 may also work and has 2x the throughput of HiFi4'];
        }

        if (mathFidelity === MathFidelity.HiFi2) {
            return ['too_low', 'If your matmuls are not FLOP-bound use HiFi4 with BF16 activations for full accuracy'];
        }

        if (mathFidelity === MathFidelity.LoFi) {
            return ['too_low', 'Use HiFi2 or HiFi4 with BF16 activations for improved accuracy'];
        }
    } else if (in0Bits === 8 && outBits === 3) {
        if (mathFidelity === MathFidelity.HiFi4) {
            return ['too_high', 'HiFi2 is very likely to work for BFP8 output and has 2x the throughput of HiFi4'];
        }

        if (mathFidelity === MathFidelity.HiFi2) {
            return ['sufficient', 'LoFi might also be sufficient with BFP4 output and has almost 2x the throughput'];
        }

        if (mathFidelity === MathFidelity.LoFi) {
            return ['too_low', 'HiFi2 may give better accuracy for large matmuls with many intermediate accumulations'];
        }
    } else if (in1Bits >= 7 && outBits >= 7) {
        if (mathFidelity === MathFidelity.HiFi4) {
            return ['too_high', 'HiFi2 is sufficient for BFP8 multiplication and faster'];
        }

        if (mathFidelity === MathFidelity.HiFi2) {
            return ['sufficient', null];
        }

        if (mathFidelity === MathFidelity.LoFi) {
            return ['too_low', 'HiFi2 is recommended for accuracy; LoFi discards low bits of weights'];
        }
    } else if (in1Bits >= 7 && outBits === 3) {
        if (mathFidelity === MathFidelity.HiFi4) {
            return ['too_high', 'HiFi2 is sufficient and 2x throughput'];
        }

        if (mathFidelity === MathFidelity.HiFi2) {
            return ['sufficient', 'LoFi might also be sufficient (BFP4 output) and has almost 2x throughput'];
        }

        if (mathFidelity === MathFidelity.LoFi) {
            return ['too_low', 'HiFi2 may give slightly better accuracy for large matmuls'];
        }
    } else if (in1Bits === 3) {
        if (mathFidelity === MathFidelity.LoFi) {
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

export const isHostOp = (bound: BoundType | null) => bound === BoundType.HOST;

export const getStandardViewCounts = (
    data: TypedPerfTableRow[],
    filteredData: TypedPerfTableRow[],
    isInitialTab: boolean,
    processedComparisonRows: TypedPerfTableRow[][],
    filteredComparisonRows: TypedPerfTableRow[],
    normalisedData: NormalisedPerfData | null,
    comparisonIndex: number,
    comparisonMaxLength?: number,
) => {
    const filtered = isInitialTab ? filteredData.length : filteredComparisonRows.length;
    let total = 0;
    let delta = 0;

    if (normalisedData) {
        total = normalisedData.data[0]?.length || 0;
    } else {
        total = isInitialTab ? data?.length || 0 : comparisonMaxLength || 0;
    }

    if (normalisedData) {
        if (isInitialTab) {
            delta = data.length - (normalisedData.data?.[0]?.length || 0);
        } else if (processedComparisonRows?.[comparisonIndex] && normalisedData.data?.[comparisonIndex + 1]) {
            delta = processedComparisonRows[comparisonIndex].length - normalisedData.data[comparisonIndex + 1].length;
        }
    }

    return { filtered, total, delta };
};

export const getStackedViewCounts = (
    data: TypedStackedPerfRow[],
    filteredData: TypedStackedPerfRow[],
    processedComparisonStackedRows: TypedStackedPerfRow[][],
    filteredComparisonRows: TypedStackedPerfRow[],
    comparisonIndex: number,
    isInitialTab: boolean,
) => {
    const filtered = isInitialTab ? filteredData.length : filteredComparisonRows.length;
    let total = data?.length;

    if (comparisonIndex > -1) {
        total = processedComparisonStackedRows[comparisonIndex]?.length || 0;
    }

    return {
        filtered,
        total,
        delta: total - filtered,
    };
};
