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

export enum StringBufferType {
    DRAM = 'DRAM',
    L1 = 'L1',
    SYSTEM_MEMORY = 'SYSTEM_MEMORY',
    L1_SMALL = 'L1_SMALL',
    TRACE = 'TRACE',
}

export const BufferTypeToStringBufferType: Record<BufferType, StringBufferType> = {
    [BufferType.DRAM]: StringBufferType.DRAM,
    [BufferType.L1]: StringBufferType.L1,
    [BufferType.SYSTEM_MEMORY]: StringBufferType.SYSTEM_MEMORY,
    [BufferType.L1_SMALL]: StringBufferType.L1_SMALL,
    [BufferType.TRACE]: StringBufferType.TRACE,
};

/**
 * The only place display labels are spelled out. `MemoryTag` slugs these into its
 * `tag-*` class, so renaming one requires a matching rule in `_common.scss`.
 */
export const StringBufferTypeLabel: Record<StringBufferType, string> = {
    [StringBufferType.DRAM]: 'DRAM',
    [StringBufferType.L1]: 'L1',
    [StringBufferType.SYSTEM_MEMORY]: 'System Memory',
    [StringBufferType.L1_SMALL]: 'L1 Small',
    [StringBufferType.TRACE]: 'Trace',
};

export const BufferTypeLabel: Record<BufferType, string> = {
    [BufferType.DRAM]: StringBufferTypeLabel[StringBufferType.DRAM],
    [BufferType.L1]: StringBufferTypeLabel[StringBufferType.L1],
    [BufferType.SYSTEM_MEMORY]: StringBufferTypeLabel[StringBufferType.SYSTEM_MEMORY],
    [BufferType.L1_SMALL]: StringBufferTypeLabel[StringBufferType.L1_SMALL],
    [BufferType.TRACE]: StringBufferTypeLabel[StringBufferType.TRACE],
};
