// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/**
 * This is a 1 to 1 mapping of the BufferType enum on tt-metal
 */
export enum BufferType {
    DRAM,
    L1,
    SYSTEM_MEMORY,
    L1_SMALL,
    TRACE,
}

export const BufferTypeLabel: Record<number, string> = {
    [BufferType.DRAM]: 'DRAM',
    [BufferType.L1]: 'L1',
    [BufferType.SYSTEM_MEMORY]: 'System Memory',
    [BufferType.L1_SMALL]: 'L1 Small',
    [BufferType.TRACE]: 'Trace',
};
export enum StringBufferType {
    DRAM = 'DRAM',
    L1 = 'L1',
    SYSTEM_MEMORY = 'SYSTEM_MEMORY',
    L1_SMALL = 'L1_SMALL',
    TRACE = 'TRACE',
}

export const StringBufferTypeLabel: Record<StringBufferType, string> = {
    [StringBufferType.DRAM]: 'DRAM',
    [StringBufferType.L1]: 'L1',
    [StringBufferType.SYSTEM_MEMORY]: 'System Memory',
    [StringBufferType.L1_SMALL]: 'L1 Small',
    [StringBufferType.TRACE]: 'Trace',
};
