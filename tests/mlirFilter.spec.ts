// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { MlirFilterMode, buildFilterMatcher } from '../src/components/mlir/mlirFilter';

describe('buildFilterMatcher', () => {
    describe('empty query', () => {
        it.each([[MlirFilterMode.Substring], [MlirFilterMode.Regex]] as const)(
            'rejects every label in %s mode',
            (mode) => {
                const { testLabel, isRegexInvalid } = buildFilterMatcher(mode, '');

                expect(testLabel('stablehlo.constant')).toBe(false);
                expect(testLabel('')).toBe(false);
                expect(isRegexInvalid).toBe(false);
            },
        );
    });

    describe('substring mode', () => {
        it('matches case-insensitive substrings', () => {
            const { testLabel } = buildFilterMatcher(MlirFilterMode.Substring, 'Add');

            expect(testLabel('stablehlo.add')).toBe(true);
            expect(testLabel('stablehlo.ADD')).toBe(true);
            expect(testLabel('stablehlo.subtract')).toBe(false);
        });

        it('treats regex metacharacters as literals', () => {
            const { testLabel } = buildFilterMatcher(MlirFilterMode.Substring, 'co*');

            // Literal `co*` never appears in normal op names.
            expect(testLabel('stablehlo.constant')).toBe(false);
            expect(testLabel('stablehlo.broadcast_in_dim')).toBe(false);
            // But the literal three-char sequence does match if it's present.
            expect(testLabel('stablehlo.co*_debug')).toBe(true);
        });

        it('never reports isRegexInvalid', () => {
            expect(buildFilterMatcher(MlirFilterMode.Substring, '(').isRegexInvalid).toBe(false);
            expect(buildFilterMatcher(MlirFilterMode.Substring, '[unclosed').isRegexInvalid).toBe(false);
        });
    });

    describe('regex mode', () => {
        it('matches case-insensitive patterns', () => {
            const { testLabel } = buildFilterMatcher(MlirFilterMode.Regex, '^stablehlo\\.');

            expect(testLabel('stablehlo.constant')).toBe(true);
            expect(testLabel('STABLEHLO.constant')).toBe(true);
            expect(testLabel('ttir.stablehlo.constant')).toBe(false);
        });

        it('honours zero-or-more semantics — `co*` matches a bare `c`', () => {
            // Regression for the "why is broadcast_in_dim matched by `co*`" question:
            // `co*` = `c` + zero-or-more `o`, so `c` alone in `broadcast` matches.
            const { testLabel } = buildFilterMatcher(MlirFilterMode.Regex, 'co*');

            expect(testLabel('stablehlo.constant')).toBe(true);
            expect(testLabel('stablehlo.broadcast_in_dim')).toBe(true);
            expect(testLabel('stablehlo.add')).toBe(false);
        });

        it('flags invalid patterns and rejects every label without throwing', () => {
            const { testLabel, isRegexInvalid } = buildFilterMatcher(MlirFilterMode.Regex, '(');

            expect(isRegexInvalid).toBe(true);
            expect(testLabel('stablehlo.constant')).toBe(false);
            expect(testLabel('anything')).toBe(false);
        });

        it('does not conflate "no matches" with "invalid regex"', () => {
            const { testLabel, isRegexInvalid } = buildFilterMatcher(MlirFilterMode.Regex, '^zzz$');

            expect(isRegexInvalid).toBe(false);
            expect(testLabel('stablehlo.constant')).toBe(false);
        });
    });
});
