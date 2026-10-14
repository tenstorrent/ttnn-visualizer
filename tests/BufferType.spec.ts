// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    BufferType,
    BufferTypeToStringBufferType,
    StringBufferType,
    isL1BufferType,
    isL1StringBufferType,
    toBufferType,
    toStringBufferType,
} from '../src/model/BufferType';

describe('isL1BufferType', () => {
    it.each([BufferType.L1, BufferType.L1_SMALL])('is true for %s', (bufferType) => {
        expect(isL1BufferType(bufferType)).toBe(true);
    });

    // DRAM is 0, so a truthiness check would wrongly pass it through as "no type".
    it.each([BufferType.DRAM, BufferType.SYSTEM_MEMORY, BufferType.TRACE, null, undefined])(
        'is false for %s',
        (bufferType) => {
            expect(isL1BufferType(bufferType)).toBe(false);
        },
    );
});

describe('toBufferType', () => {
    // The two maps are written out by hand; a swapped entry would still compile.
    it.each(Object.values(StringBufferType))('round-trips %s', (name) => {
        expect(BufferTypeToStringBufferType[toBufferType(name)!]).toBe(name);
    });

    it.each(['FUTURE_MEMORY', 'constructor', '', null, undefined])('is null for %s', (name) => {
        expect(toBufferType(name)).toBeNull();
    });
});

describe('toStringBufferType', () => {
    it.each(Object.values(StringBufferType))('is %s for its own name', (name) => {
        expect(toStringBufferType(name)).toBe(name);
    });

    it.each(['FUTURE_MEMORY', 'constructor', '', null, undefined])('is null for %s', (name) => {
        expect(toStringBufferType(name)).toBeNull();
    });
});

describe('isL1StringBufferType', () => {
    it.each([StringBufferType.L1, StringBufferType.L1_SMALL])('is true for %s', (name) => {
        expect(isL1StringBufferType(name)).toBe(true);
    });

    it.each([StringBufferType.DRAM, 'FUTURE_MEMORY', null, undefined])('is false for %s', (name) => {
        expect(isL1StringBufferType(name)).toBe(false);
    });
});
