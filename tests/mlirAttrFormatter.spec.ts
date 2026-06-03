// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { ParsedAttrKind, tryParseAttrValue } from '../src/components/mlir/attrFormatter';

describe('tryParseAttrValue', () => {
    it('returns a scalar for an empty string without attempting to parse it', () => {
        expect(tryParseAttrValue('')).toEqual({ kind: ParsedAttrKind.Scalar, text: '' });
    });

    it.each([
        ['MLIR pseudo-JSON', 'tensor<4x8xf32>'],
        ['identifier-style token', 'f32'],
        ['unbalanced bracket', '[4, 8'],
        ['stray colon', 'foo: bar'],
    ])('falls back to scalar for unparseable input (%s)', (_label, value) => {
        expect(tryParseAttrValue(value)).toEqual({ kind: ParsedAttrKind.Scalar, text: value });
    });

    it.each([
        ['number', '42'],
        ['boolean', 'true'],
        ['null literal', 'null'],
        ['JSON string', '"hello"'],
    ])('keeps JSON primitives (%s) as scalars and preserves the original text', (_label, value) => {
        // Primitives are valid JSON but render better as their original
        // textual form (e.g. show `"hello"` rather than `hello`).
        expect(tryParseAttrValue(value)).toEqual({ kind: ParsedAttrKind.Scalar, text: value });
    });

    it('returns an object kind for JSON object input', () => {
        const result = tryParseAttrValue('{"lhs":[1],"rhs":[0]}');
        expect(result).toEqual({
            kind: ParsedAttrKind.Object,
            parsed: { lhs: [1], rhs: [0] },
        });
    });

    it('returns an array kind for JSON array input, preserving element types', () => {
        const result = tryParseAttrValue('[1, 7, 3072]');
        expect(result).toEqual({ kind: ParsedAttrKind.Array, parsed: [1, 7, 3072] });
    });

    it('returns an array kind for mixed-primitive arrays without coercion', () => {
        // Important for the port-metadata compact pill: a `shape` attr is
        // recognised as a tensor descriptor only when every element is a
        // primitive, so the array structure has to round-trip faithfully.
        const result = tryParseAttrValue('[1, "x", true, null]');
        expect(result).toEqual({ kind: ParsedAttrKind.Array, parsed: [1, 'x', true, null] });
    });
});
