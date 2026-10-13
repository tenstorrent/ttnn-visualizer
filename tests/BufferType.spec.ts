// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { BufferType, toBufferType } from '../src/model/BufferType';

describe('toBufferType', () => {
    it.each([
        ['the enum value', 3, BufferType.L1_SMALL],
        ['the value as text', '3', BufferType.L1_SMALL],
        ['the name', 'L1_SMALL', BufferType.L1_SMALL],
        ['the C++ enum name', 'BufferType::L1_SMALL', BufferType.L1_SMALL],
        ['DRAM, whose value is falsy', 0, BufferType.DRAM],
    ])('reads %s', (_label, value, expected) => {
        expect(toBufferType(value)).toBe(expected);
    });

    it.each([
        ['an out-of-range value', 99],
        ['an unknown name', 'FOO'],
        ['an empty string', ''],
        ['null', null],
        ['undefined', undefined],
    ])('gives undefined for %s', (_label, value) => {
        expect(toBufferType(value)).toBeUndefined();
    });
});
