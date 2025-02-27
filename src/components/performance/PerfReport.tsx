// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

/* eslint camelcase: "off" */
import React, { FC, useState } from 'react';
import '../../scss/components/PerfTable.scss';
import { Switch } from '@blueprintjs/core';
import { useAtomValue } from 'jotai';
import { evaluate_fidelity, formatCell } from '../../functions/perfFunctions';
import { MathFidelity, PerfTableRow, ProcessedRow } from '../../definitions/PerfTable';
import { useOptoPerfIdFiltered } from '../../hooks/useAPI';
import { selectedPerformanceRangeAtom } from '../../store/app';

// The main React component
interface PerformanceReportProps {
    data?: PerfTableRow[];
    minPercentage?: number;
}

export const PerformanceReport: FC<PerformanceReportProps> = ({ data, minPercentage = 0.5 }) => {
    const [mergeDeviceData, setMergeDeviceData] = useState<boolean>(true);
    const [provideMatmulAdvice, setProvideMatmulAdvice] = useState<boolean>(false);
    const [hiliteHighDispatch, setHiliteHighDispatch] = useState<boolean>(false);
    const [isMultiDevice, setIsMultiDevice] = useState<boolean>(false);
    const selectedRange = useAtomValue(selectedPerformanceRangeAtom);
    const opIdsMap = useOptoPerfIdFiltered();

    const processedRows = data;

    const tableHeaders = [
        { label: 'ID', key: 'id' },
        { label: 'OP', key: 'op' },
        { label: 'Total %', key: 'total_percent' },
        { label: 'Bound', key: 'bound' },
        { label: 'OP Code', key: 'op_code' },
        { label: 'Device Time', key: 'device_time' },
        { label: 'Op-to-Op Gap', key: 'op_to_op_gap' },
        { label: 'Cores', key: 'cores' },
        { label: 'DRAM', key: 'dram' },
        { label: 'DRAM %', key: 'dram_percent' },
        { label: 'FLOPs', key: 'flops' },
        { label: 'FLOPs %', key: 'flops_percent' },
        { label: 'Math Fidelity', key: 'math_fidelity' },
    ];
    const visibleHeaders = hiliteHighDispatch
        ? [...tableHeaders.slice(0, 5), 'Slow', ...tableHeaders.slice(5)]
        : tableHeaders;

    const getFilteredRows = () => {
        return selectedRange && processedRows.length > 0
            ? processedRows.filter((row) => {
                  const rowId = parseInt(String(row?.ID?.raw_value), 10);

                  return rowId >= selectedRange[0] && rowId <= selectedRange[1];
              })
            : processedRows;
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
                        {getFilteredRows().map((row, i) => (
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
                                {provideMatmulAdvice && row.op_code.raw_value?.toString().includes('Matmul') && (
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
        const opCodeColor = op_data.op_code.color === 'grey' ? 'grey' : 'white';

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
