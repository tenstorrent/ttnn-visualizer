// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_DIRECTORY = 'src';
const STYLESHEET_DIRECTORY = 'src/scss';
const CSS_VAR_DEFINITION_FILE = join('src', 'functions', 'colour.ts');

const CSS_VAR_LITERAL_CALL = /\bcssVar\((['`])(--[a-z0-9-]+)\1\)/g;
const CSS_VAR_REFERENCE = /\bcssVar\b/;
const CSS_VAR_DEFINITION = /^export const cssVar = /m;
// An alias would hide every later call from this scan, so an import that renames `cssVar` is
// left in place to be reported.
const CSS_VAR_ALIAS = /\bcssVar\s+as\b/;
const IMPORT_STATEMENT = /^import\b[\s\S]*?\bfrom\s*['"][^'"]+['"];?/gm;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;
// Anchored to the line start so a property named in a comment or read through `var(--x)`
// is not mistaken for a declaration.
const CUSTOM_PROPERTY_DECLARATION = /^\s*(--[a-z0-9-]+)\s*:/gm;

interface SourceLine {
    location: string;
    text: string;
}

const readFilesWithExtensions = (directory: string, extensions: string[]) =>
    readdirSync(resolve(process.cwd(), directory), { recursive: true, encoding: 'utf8' })
        .filter((relativePath) => extensions.includes(extname(relativePath)))
        .map((relativePath) => {
            const path = join(directory, relativePath);

            return { path, text: readFileSync(resolve(process.cwd(), path), 'utf8') };
        });

// Blanks a match but keeps its newlines, so reported line numbers still point at the source.
const blankKeepingLines = (match: string) => match.replace(/[^\n]/g, '');

// Imports and the definition are the references that are neither a call nor checkable, and
// comment lines are skipped so a docstring naming `cssVar` is not taken for one.
const sourceLines: SourceLine[] = readFilesWithExtensions(SOURCE_DIRECTORY, ['.ts', '.tsx']).flatMap(
    ({ path, text }) => {
        const withoutImports = text.replace(IMPORT_STATEMENT, (statement) =>
            CSS_VAR_ALIAS.test(statement) ? statement : blankKeepingLines(statement),
        );
        const scanned =
            path === CSS_VAR_DEFINITION_FILE ? withoutImports.replace(CSS_VAR_DEFINITION, '') : withoutImports;

        return scanned
            .split('\n')
            .map((line, index) => ({ location: `${path}:${index + 1}`, text: line }))
            .filter(({ text: line }) => !COMMENT_LINE.test(line));
    },
);

const literalNames = sourceLines.flatMap(({ text }) =>
    [...text.matchAll(CSS_VAR_LITERAL_CALL)].map(([, , name]) => name),
);

const declaredNames = new Set(
    readFilesWithExtensions(STYLESHEET_DIRECTORY, ['.scss']).flatMap(({ text }) =>
        [...text.matchAll(CUSTOM_PROPERTY_DECLARATION)].map(([, name]) => name),
    ),
);

// `cssVar` returns '' for a property nobody declared, without an error, so a rename in a
// stylesheet would otherwise leave every reader drawing in no colour (#1911).
//
// What this does not check: that a name is declared on `:root`, which is where `cssVar` reads
// it. A property declared only under a component selector passes here and still resolves to ''.
describe('cssVar custom properties', () => {
    it('is only called with a literal property name, so every read can be checked', () => {
        const uncheckableReferences = sourceLines
            .filter(({ text }) => CSS_VAR_REFERENCE.test(text.replace(CSS_VAR_LITERAL_CALL, '')))
            .map(({ location, text }) => `${location}: ${text.trim()}`);

        expect(literalNames.length).toBeGreaterThan(0);
        expect(uncheckableReferences).toEqual([]);
    });

    it('reads only properties a stylesheet declares', () => {
        expect([...new Set(literalNames)].filter((name) => !declaredNames.has(name))).toEqual([]);
    });
});
