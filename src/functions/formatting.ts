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
    return input.replace(/^DataType\./, '');
};

export const toReadableLayout = (input: TensorMemoryLayout) => {
    return input.replace(/^TensorMemoryLayout::/, '');
};
