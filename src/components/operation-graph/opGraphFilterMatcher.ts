// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// String-backed because the mode is persisted to `sessionStorage`.
export enum OpGraphFilterMode {
    SUBSTRING = 'substring',
    REGEX = 'regex',
}

export interface OpGraphFilterMatcher {
    /** True when an operation name counts as a filter match. */
    testName: (name: string) => boolean;
    /** True only in regex mode, when the query fails to compile. */
    isRegexInvalid: boolean;
}

// An empty query and an uncompilable regex both yield a matcher that rejects
// everything, so callers need no branch per case; `isRegexInvalid` is what tells
// the UI "nothing typed" apart from "bad pattern". Deliberately a twin of
// `mlir/mlirFilter.ts` until the shared graph-filter seam is extracted. #1809
export function buildOpGraphFilterMatcher(mode: OpGraphFilterMode, query: string): OpGraphFilterMatcher {
    if (query.length === 0) {
        return { testName: () => false, isRegexInvalid: false };
    }
    if (mode === OpGraphFilterMode.REGEX) {
        try {
            const pattern = new RegExp(query, 'i');
            return { testName: (name) => pattern.test(name), isRegexInvalid: false };
        } catch {
            return { testName: () => false, isRegexInvalid: true };
        }
    }
    const needle = query.toLowerCase();
    return {
        testName: (name) => name.toLowerCase().includes(needle),
        isRegexInvalid: false,
    };
}
