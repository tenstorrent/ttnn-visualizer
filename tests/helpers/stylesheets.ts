// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from 'sass';
import { expect } from 'vitest';
// @ts-expect-error don't have types declaration for sassOptions
import { createSassOptions } from '../../src/libs/blueprintjs/sassOptions';

// Specs read stylesheets because jsdom does not apply them: a rendered element
// carries its classes but none of their declarations. Paths are anchored on the
// cwd rather than `import.meta.url`, which jsdom serves over http.
const ROOT = process.cwd();
const STYLES_ALIAS = 'styles/';

/** A stylesheet's source text, for assertions about how a rule is written. */
export const getStylesheet = (path: string): string => readFileSync(resolve(ROOT, path), { encoding: 'utf8' });

/** The declarations between the first `{` after `selector` and the next `}` in the source text. */
export const getRuleBody = (stylesheet: string, selector: string): string => {
    const start = stylesheet.indexOf(selector);
    expect(start, `${selector} not found`).toBeGreaterThan(-1);
    const open = stylesheet.indexOf('{', start);
    return stylesheet.slice(open + 1, stylesheet.indexOf('}', open));
};

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

/** Every style rule in compiled CSS, including those inside at-rules such as `@media`. */
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
            if (prelude && !prelude.startsWith('@') && !/^(from|to|\d+%)/.test(prelude)) {
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
