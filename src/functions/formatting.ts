// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { TensorMemoryLayout } from './parseMemoryConfig';

export const toReadableShape = (input: string) => {
    const match = input.match(/(?:Shape|torch\.Size)\((\[.*\])\)/);
    if (!match) {
        return input;
    }
    return match[1];
};

export const toReadableType = (input: string) => {
    return toShortTypeLabel(stripEnum(input));
};

export const toReadableLayout = (input: TensorMemoryLayout | string) => {
    // TODO: we may want to consider getting rid of uppercase and underscores in the future
    return stripEnum(input); // .toLowerCase().replaceAll('_', '-');
};

export const capitalizeString = (input: string) => {
    return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
};

export const stripEnum = (v: string) => {
    if (!v) {
        return v;
    }
    const str = v.toString();
    const parsed = str.split(/::|\./);

    return parsed[parsed.length - 1] || str;
};

const TYPE_LABELS: Record<string, string> = {
    UINT8: 'u8',
    UINT16: 'u16',
    INT32: 'i32',
    UINT32: 'u32',
    FLOAT32: 'f32',
    BFLOAT16: 'bf16',
    BFLOAT8_B: 'bf8',
    BFLOAT4_B: 'bf4',
};

const toShortTypeLabel = (input: string) => {
    const key = stripEnum(input);
    if (!key) {
        return input;
    }
    return TYPE_LABELS[key] ?? key.toLowerCase();
};
