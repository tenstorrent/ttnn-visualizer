// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

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

export const BufferTypeLabel: Record<BufferType, string> = {
    [BufferType.DRAM]: 'DRAM',
    [BufferType.L1]: 'L1',
    [BufferType.SYSTEM_MEMORY]: 'System Memory',
    [BufferType.L1_SMALL]: 'L1 Small',
    [BufferType.TRACE]: 'Trace',
};
