// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { OpGraphFilterMode, buildOpGraphFilterMatcher } from '../src/components/operation-graph/opGraphFilterMatcher';

const substring = (query: string) => buildOpGraphFilterMatcher(OpGraphFilterMode.SUBSTRING, query);
const regex = (query: string) => buildOpGraphFilterMatcher(OpGraphFilterMode.REGEX, query);

describe('buildOpGraphFilterMatcher', () => {
    it('matches a substring regardless of case', () => {
        const matcher = substring('MatMul');

        expect(matcher.testName('ttnn.matmul')).toBe(true);
        expect(matcher.testName('ttnn.add')).toBe(false);
        expect(matcher.isRegexInvalid).toBe(false);
    });

    it('treats regex metacharacters literally in substring mode', () => {
        // Op names are dotted, so a user typing `ttnn.matmul` means the dot.
        expect(substring('ttnn.matmul').testName('ttnnXmatmul')).toBe(false);
    });

    it('matches a pattern case-insensitively in regex mode', () => {
        const matcher = regex('^ttnn\\.(matmul|add)$');

        expect(matcher.testName('TTNN.MatMul')).toBe(true);
        expect(matcher.testName('ttnn.subtract')).toBe(false);
        expect(matcher.isRegexInvalid).toBe(false);
    });

    it('reports an uncompilable pattern instead of throwing mid-keystroke', () => {
        // Every prefix of a real pattern is typed, and `(ttnn` is one of them.
        const matcher = regex('(ttnn');

        expect(matcher.isRegexInvalid).toBe(true);
        expect(matcher.testName('ttnn.matmul')).toBe(false);
    });

    it('distinguishes an empty query from a bad pattern', () => {
        // Both match nothing; only `isRegexInvalid` tells the input whether to
        // show an error, so an empty field must not look like a typo.
        for (const matcher of [substring(''), regex('')]) {
            expect(matcher.testName('ttnn.matmul')).toBe(false);
            expect(matcher.isRegexInvalid).toBe(false);
        }
    });
});
