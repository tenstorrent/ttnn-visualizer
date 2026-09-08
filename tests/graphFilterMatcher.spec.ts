// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { GraphFilterMode } from '../src/definitions/GraphFilterMode';
import { buildGraphFilterMatcher } from '../src/functions/graphFilterMatcher';

const substring = (query: string) => buildGraphFilterMatcher(GraphFilterMode.SUBSTRING, query);
const regex = (query: string) => buildGraphFilterMatcher(GraphFilterMode.REGEX, query);

describe('buildGraphFilterMatcher', () => {
    describe('empty query', () => {
        it.each([[GraphFilterMode.SUBSTRING], [GraphFilterMode.REGEX]] as const)(
            'rejects everything in %s mode',
            (mode) => {
                const { test, isRegexInvalid } = buildGraphFilterMatcher(mode, '');

                expect(test('stablehlo.constant')).toBe(false);
                expect(test('')).toBe(false);
                expect(isRegexInvalid).toBe(false);
            },
        );

        it('distinguishes an empty query from a bad pattern', () => {
            // Both match nothing; only `isRegexInvalid` tells the input whether to
            // show an error, so an empty field must not look like a typo.
            for (const matcher of [substring(''), regex('')]) {
                expect(matcher.test('ttnn.matmul')).toBe(false);
                expect(matcher.isRegexInvalid).toBe(false);
            }
        });
    });

    describe('substring mode', () => {
        it('matches case-insensitive substrings', () => {
            const { test } = substring('Add');

            expect(test('stablehlo.add')).toBe(true);
            expect(test('stablehlo.ADD')).toBe(true);
            expect(test('stablehlo.subtract')).toBe(false);
        });

        it('treats regex metacharacters as literals', () => {
            const { test } = substring('co*');

            // Literal `co*` never appears in normal op names.
            expect(test('stablehlo.constant')).toBe(false);
            expect(test('stablehlo.broadcast_in_dim')).toBe(false);
            // But the literal three-char sequence does match if it's present.
            expect(test('stablehlo.co*_debug')).toBe(true);
        });

        it('treats a dot as a dot', () => {
            // Op names are dotted, so a user typing `ttnn.matmul` means the dot.
            expect(substring('ttnn.matmul').test('ttnnXmatmul')).toBe(false);
        });

        it('never reports isRegexInvalid', () => {
            expect(substring('(').isRegexInvalid).toBe(false);
            expect(substring('[unclosed').isRegexInvalid).toBe(false);
        });
    });

    describe('regex mode', () => {
        it('matches case-insensitive patterns', () => {
            const { test } = regex('^stablehlo\\.');

            expect(test('stablehlo.constant')).toBe(true);
            expect(test('STABLEHLO.constant')).toBe(true);
            expect(test('ttir.stablehlo.constant')).toBe(false);
        });

        it('honours alternation and anchors', () => {
            const { test } = regex('^ttnn\\.(matmul|add)$');

            expect(test('TTNN.MatMul')).toBe(true);
            expect(test('ttnn.subtract')).toBe(false);
        });

        it('honours zero-or-more semantics — `co*` matches a bare `c`', () => {
            // Regression for the "why is broadcast_in_dim matched by `co*`" question:
            // `co*` = `c` + zero-or-more `o`, so `c` alone in `broadcast` matches.
            const { test } = regex('co*');

            expect(test('stablehlo.constant')).toBe(true);
            expect(test('stablehlo.broadcast_in_dim')).toBe(true);
            expect(test('stablehlo.add')).toBe(false);
        });

        it('flags invalid patterns and rejects everything without throwing', () => {
            // Every prefix of a real pattern gets typed, and `(ttnn` is one of them.
            const { test, isRegexInvalid } = regex('(ttnn');

            expect(isRegexInvalid).toBe(true);
            expect(test('ttnn.matmul')).toBe(false);
            expect(test('anything')).toBe(false);
        });

        it('does not conflate "no matches" with "invalid regex"', () => {
            const { test, isRegexInvalid } = regex('^zzz$');

            expect(isRegexInvalid).toBe(false);
            expect(test('stablehlo.constant')).toBe(false);
        });
    });
});
