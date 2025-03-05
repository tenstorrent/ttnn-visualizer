// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { FC, Fragment, useMemo, useState } from 'react';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { Icon, Switch, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { MathFidelity, PerfTableRow } from '../../definitions/PerfTable';
import { formatSize, toSecondsPretty } from '../../functions/math';
import { selectedPerformanceRangeAtom } from '../../store/app';
import 'styles/components/PerfReport.scss';

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
    const selectedRange = useAtomValue(selectedPerformanceRangeAtom);
    // const opIdsMap = useOptoPerfIdFiltered();

    const processedRows: PerfTableRow[] = useMemo(() => {
        return (
            data?.map((opData) => {
                const val = parseInt(opData.op_to_op_gap, 10);

                return {
                    ...opData,
                    high_dispatch: !!val && val > 6.5,
                };
            }) || []
        );
    }, [data]);

    const getFilteredRows: PerfTableRow[] = useMemo(() => {
        return selectedRange && processedRows.length > 0
            ? processedRows.filter((row) => {
                  const rowId = parseInt(row?.id, 10);

                  return rowId >= selectedRange[0] && rowId <= selectedRange[1];
              })
            : processedRows;
    }, [processedRows, selectedRange]);

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
                                            {formatCell(row, header)}
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

const formatCell = (row: PerfTableRow, header: TableHeader): React.JSX.Element | string => {
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

const getCellColour = (row: PerfTableRow, key: TableKeys): CellColour | '' => {
    const keyValue = row[key];
    const percentage = parseFloat(row.total_percent);

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
        const cores = (typeof keyValue === 'string' ? parseInt(keyValue, 10) : keyValue) as number;

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
        const parsedValue = keyValue ? parseInt(keyValue, 10) : 0;

        return parsedValue > 6.5 ? 'red' : '';
    }

    // Shouldn't get to this point but need to return something
    return 'grey';
};

const calcHighDispatchOps = (rows: PerfTableRow[]) => {
    const highDispatchOps = rows
        .map((opData: PerfTableRow, index: number): [number, PerfTableRow] => [index + 1, opData])
        .filter(([_, opData]) => {
            const val = opData.op_to_op_gap;
            return val !== null && val !== undefined && typeof val === 'number' && val > 6.5;
        });

    if (highDispatchOps.length === 0) {
        return null;
    }

    // Compute the max dispatch overhead
    const maxDispatchOverhead = highDispatchOps.reduce((acc, [_, opData]) => {
        const val = parseInt(opData.op_to_op_gap, 10);

        return acc + (val - 6);
    }, 0);

    // Compute total_duration as sum of device times + Op-to-Op Gaps
    const totalDeviceTime = rows.reduce((acc, r) => {
        const val = parseInt(r.device_time, 10);

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

function evaluateFidelity(
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
