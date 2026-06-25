// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { TypedPerfTableRow } from '../../definitions/PerfTable';
import { formatPercentage, formatSize } from '../../functions/math';
import { getKernelTimings } from '../../functions/perfKernelTimings';

interface PerfKernelTimingRowProps {
    row: TypedPerfTableRow;
    colSpan: number;
}

const NS_PER_US = 1000;

const PerfKernelTimingRow = ({ row, colSpan }: PerfKernelTimingRowProps) => {
    const timings = getKernelTimings(row);
    const total = row.device_kernel_duration && row.device_kernel_duration > 0 ? row.device_kernel_duration : null;

    return (
        <tr className='kernel-timing-row'>
            <td
                colSpan={colSpan}
                className='cell kernel-timing'
            >
                <table className='kernel-timing-breakdown'>
                    <tbody>
                        {timings.map((timing) => (
                            <tr key={timing.name}>
                                <th className='kernel-name'>{timing.name}</th>
                                <td className='kernel-duration'>{formatSize(timing.ns / NS_PER_US, 2)} µs</td>
                                <td className='kernel-percent'>
                                    {total ? formatPercentage((timing.ns / total) * 100, 1) : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </td>
        </tr>
    );
};

export default PerfKernelTimingRow;
