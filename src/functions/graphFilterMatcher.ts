// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { GraphFilterMode } from '../definitions/GraphFilterMode';

export interface GraphFilterMatcher {
    /** True when the text under test counts as a filter match. */
    test: (text: string) => boolean;
    /** True only in regex mode, when the query fails to compile. */
    isRegexInvalid: boolean;
}

// An empty query and an uncompilable regex both yield a matcher that rejects
// everything, so callers need no branch per case; `isRegexInvalid` is what tells
// the UI "nothing typed" apart from "bad pattern".
export function buildGraphFilterMatcher(mode: GraphFilterMode, query: string): GraphFilterMatcher {
    if (query.length === 0) {
        return { test: () => false, isRegexInvalid: false };
    }
    if (mode === GraphFilterMode.REGEX) {
        try {
            const pattern = new RegExp(query, 'i');
            return { test: (text) => pattern.test(text), isRegexInvalid: false };
        } catch {
            return { test: () => false, isRegexInvalid: true };
        }
    }
    const needle = query.toLowerCase();
    return {
        test: (text) => text.toLowerCase().includes(needle),
        isRegexInvalid: false,
    };
}
