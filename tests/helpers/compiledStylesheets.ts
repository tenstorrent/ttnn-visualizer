// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from 'sass';
// @ts-expect-error don't have types declaration for sassOptions
import { createSassOptions } from '../../src/libs/blueprintjs/sassOptions';
import { ROOT } from './stylesheets';

// The fourth place the `styles/` alias is wired, after `tsconfig.json`,
// `vite.config.ts` and `vitest.config.ts`.
const STYLES_ALIAS = 'styles/';

const KEYFRAMES = /^@(?:-[a-z]+-)?keyframes\b/;

export interface CompiledRule {
    selectors: string[];
    body: string;
}

/**
 * A stylesheet compiled with the options Vite builds with, plus the `styles/`
 * alias Vite resolves for it, so assertions see the selectors that ship.
 */
export const getCompiledStylesheet = (path: string): string => {
    const options = createSassOptions(ROOT);
    return compile(resolve(ROOT, path), {
        ...options,
        style: 'expanded',
        importers: [
            {
                findFileUrl: (url: string) =>
                    url.startsWith(STYLES_ALIAS)
                        ? pathToFileURL(resolve(ROOT, 'src/scss', url.slice(STYLES_ALIAS.length)))
                        : null,
            },
        ],
    }).css;
};

// Splits a selector list on its own commas, not those inside `:not(a, b)` or `:where(a, b)`.
const splitSelectorList = (prelude: string): string[] => {
    const selectors: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < prelude.length; index++) {
        const char = prelude[index];
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
        } else if (char === ',' && depth === 0) {
            selectors.push(prelude.slice(start, index));
            start = index + 1;
        }
    }
    selectors.push(prelude.slice(start));
    return selectors.map((selector) => selector.replace(/\s+/g, ' ').trim());
};

/**
 * Every style rule in compiled CSS, including those inside at-rules such as
 * `@media`. Keyframe stops are not style rules, so anything inside
 * `@keyframes` is skipped.
 */
export const getCompiledRules = (css: string): CompiledRule[] => {
    const rules: CompiledRule[] = [];
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const preludes: string[] = [];
    let segmentStart = 0;

    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (char === '{') {
            preludes.push(source.slice(segmentStart, index).split(';').pop()!.trim());
            segmentStart = index + 1;
        } else if (char === '}') {
            const prelude = preludes.pop() ?? '';
            const inKeyframes = preludes.some((ancestor) => KEYFRAMES.test(ancestor));
            if (prelude && !prelude.startsWith('@') && !inKeyframes) {
                rules.push({
                    selectors: splitSelectorList(prelude),
                    body: source.slice(segmentStart, index),
                });
            }
            segmentStart = index + 1;
        }
    }

    return rules;
};
