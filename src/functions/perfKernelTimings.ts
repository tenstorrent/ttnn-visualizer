// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { TypedPerfTableRow } from '../definitions/PerfTable';

export interface KernelTiming {
    name: string;
    ns: number;
}

// Per-RISC kernel durations live on the row as raw nanosecond values (#1518). They run
// concurrently, so each is shown as its share of the op's overall device kernel duration
// rather than as a partition that sums to 100%.
const PROCESSORS: { name: string; key: keyof TypedPerfTableRow }[] = [
    { name: 'BRISC', key: 'brisc_kernel_duration' },
    { name: 'NCRISC', key: 'ncrisc_kernel_duration' },
    { name: 'TRISC0', key: 'trisc0_kernel_duration' },
    { name: 'TRISC1', key: 'trisc1_kernel_duration' },
    { name: 'TRISC2', key: 'trisc2_kernel_duration' },
    { name: 'ERISC', key: 'erisc_kernel_duration' },
];

/** Per-RISC kernel timings present on the row, non-zero only, sorted by duration desc. */
export const getKernelTimings = (row: TypedPerfTableRow): KernelTiming[] =>
    PROCESSORS.map(({ name, key }) => ({ name, ns: row[key] as number | null }))
        .filter((timing): timing is KernelTiming => !!timing.ns && timing.ns > 0)
        .sort((a, b) => b.ns - a.ns);

/** True when the row has any per-RISC kernel timing worth expanding (device ops only). */
export const hasKernelTiming = (row: TypedPerfTableRow): boolean =>
    PROCESSORS.some(({ key }) => {
        const value = row[key] as number | null;
        return !!value && value > 0;
    });
