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

export const StringBufferTypeToBufferType = new Map<string, BufferType>(
    Object.entries(BufferTypeToStringBufferType).map(([bufferType, name]) => [name, Number(bufferType) as BufferType]),
);

const CPP_ENUM_PREFIX = 'BufferType::';

/**
 * A recorded `buffer_type` as a `BufferType`. Captures write the enum's value,
 * but at least one writes its C++ name (`'BufferType::DRAM'`) instead.
 */
export const toBufferType = (value: unknown): BufferType | undefined => {
    if (typeof value === 'number') {
        return BufferType[value] !== undefined ? value : undefined;
    }

    if (typeof value !== 'string' || value === '') {
        return undefined;
    }

    if (/^\d+$/.test(value)) {
        return toBufferType(Number(value));
    }

    return StringBufferTypeToBufferType.get(
        value.startsWith(CPP_ENUM_PREFIX) ? value.slice(CPP_ENUM_PREFIX.length) : value,
    );
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
