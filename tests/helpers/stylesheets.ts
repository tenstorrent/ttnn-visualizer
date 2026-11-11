// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';

// Specs read stylesheets because jsdom does not apply them: a rendered element
// carries its classes but none of their declarations. Paths are anchored on the
// cwd rather than `import.meta.url`, which jsdom serves over http.
//
// Source-text helpers only. Compiling lives in `compiledStylesheets.ts`, so a
// spec that only reads source text does not load Sass.
export const ROOT = process.cwd();

/** A stylesheet's source text, for assertions about how a rule is written. */
export const getStylesheet = (path: string): string => readFileSync(resolve(ROOT, path), { encoding: 'utf8' });

/** The declarations between the first `{` after `selector` and the next `}` in the source text. */
export const getRuleBody = (stylesheet: string, selector: string): string => {
    const start = stylesheet.indexOf(selector);
    expect(start, `${selector} not found`).toBeGreaterThan(-1);
    const open = stylesheet.indexOf('{', start);
    return stylesheet.slice(open + 1, stylesheet.indexOf('}', open));
};
