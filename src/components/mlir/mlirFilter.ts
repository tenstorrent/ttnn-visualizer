// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export type MlirFilterMode = 'substring' | 'regex';

export interface MlirFilterMatcher {
    /** True if a source label should be treated as a filter match. */
    testLabel: (label: string) => boolean;
    /** True only in regex mode when the query fails to compile. */
    isRegexInvalid: boolean;
}

// Empty queries and invalid regexes both surface a matcher that rejects
// everything so the caller doesn't need branch-per-case handling; the
// `isRegexInvalid` flag lets the UI distinguish "no query" from "bad regex".
export function buildFilterMatcher(mode: MlirFilterMode, query: string): MlirFilterMatcher {
    if (query.length === 0) {
        return { testLabel: () => false, isRegexInvalid: false };
    }
    if (mode === 'regex') {
        try {
            const re = new RegExp(query, 'i');
            return { testLabel: (label) => re.test(label), isRegexInvalid: false };
        } catch {
            return { testLabel: () => false, isRegexInvalid: true };
        }
    }
    const needle = query.toLowerCase();
    return {
        testLabel: (label) => label.toLowerCase().includes(needle),
        isRegexInvalid: false,
    };
}
