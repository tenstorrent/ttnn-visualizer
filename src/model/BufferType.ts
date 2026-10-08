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

export const StringBufferTypeToBufferType: Record<StringBufferType, BufferType> = {
    [StringBufferType.DRAM]: BufferType.DRAM,
    [StringBufferType.L1]: BufferType.L1,
    [StringBufferType.SYSTEM_MEMORY]: BufferType.SYSTEM_MEMORY,
    [StringBufferType.L1_SMALL]: BufferType.L1_SMALL,
    [StringBufferType.TRACE]: BufferType.TRACE,
};

/** Buffer types that take space in a core's L1, as opposed to DRAM or host memory. */
const L1_RESIDENT_BUFFER_TYPES: ReadonlySet<BufferType> = new Set([BufferType.L1, BufferType.L1_SMALL]);

export const isL1BufferType = (bufferType: BufferType | null | undefined): boolean =>
    bufferType != null && L1_RESIDENT_BUFFER_TYPES.has(bufferType);

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
