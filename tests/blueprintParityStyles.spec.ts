// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compile } from 'sass';
import { describe, expect, it } from 'vitest';
// @ts-expect-error don't have types declaration for sassOptions
import { createSassOptions } from '../src/libs/blueprintjs/sassOptions';

// Blueprint 6.7+ draws its dark theme from --bp-* design tokens, and _blueprintjs-parity.scss puts the
// Blueprint 6.6 rendering back. These checks pin a sample of the restored values, as Blueprint 6.6 compiled
// them, so a Blueprint upgrade that changes what wins for these selectors fails here instead of silently
// changing the app's colours. They read the last rule declaring a property for an exact selector, which is
// what wins between rules of equal specificity; they cannot see a Blueprint rule that wins by specificity.

const ROOT = resolve(__dirname, '..');
const STYLESHEETS = ['src/scss/_blueprintjs.scss', 'src/scss/_blueprintjs-parity.scss'];

interface Declaration {
    order: number;
    value: string;
}

// Blueprint and our partials quote attribute values differently, which does not change what they match
const normaliseSelector = (selector: string) =>
    selector
        .replace(/\s+/g, ' ')
        .replace(/=(["'])([^"']*)\1/g, '=$2')
        .trim();

// The same options Vite builds with, so these checks see the CSS that ships
const compileBlueprintStyles = () => compile(join(ROOT, STYLESHEETS[0]), createSassOptions(ROOT)).css;

/** Every top-level declaration, keyed by `selector|property`, keeping only the last one in source order. */
const indexDeclarations = (css: string) => {
    const declarations = new Map<string, Declaration>();
    const openSelectors: string[] = [];
    let order = 0;

    for (const [, text, brace] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)([{}])/g)) {
        if (brace === '{') {
            openSelectors.push(text.trim());
        } else {
            const selectorList = openSelectors.pop() ?? '';
            const isTopLevelRule = selectorList !== '' && !selectorList.startsWith('@') && openSelectors.length === 0;

            if (isTopLevelRule) {
                order += 1;
                const ruleOrder = order;

                text.split(';')
                    .filter((declaration) => declaration.includes(':'))
                    .forEach((declaration) => {
                        const colon = declaration.indexOf(':');
                        const property = declaration.slice(0, colon).trim();
                        const value = declaration.slice(colon + 1).trim();

                        selectorList.split(',').forEach((selector) => {
                            declarations.set(`${normaliseSelector(selector)}|${property}`, { order: ruleOrder, value });
                        });
                    });
            }
        }
    }

    return declarations;
};

const css = compileBlueprintStyles();
const declarations = indexDeclarations(css);

const winningDeclaration = (selector: string, property: string) =>
    declarations.get(`${normaliseSelector(selector)}|${property}`);

const DARK_INPUT_SHADOW = 'inset 0 0 0 1px rgba(255, 255, 255, 0.2), inset 0 -1px 1px 0 rgba(255, 255, 255, 0.3)';
const DARK_DROP_SHADOW_3 = '0 2px 4px rgba(17, 20, 24, 0.4), 0 8px 24px rgba(17, 20, 24, 0.4)';

// [selector, property, Blueprint 6.6 value]
const BLUEPRINT_6_6_VALUES: [string, string, string][] = [
    ['.bp6-dark .bp6-button:not([class*="bp6-intent-"])', 'background-color', '#343434'],
    ['.bp6-dark .bp6-button:not([class*="bp6-intent-"])', 'color', '#f6f7f9'],
    ['.bp6-dark .bp6-button:not([class*="bp6-intent-"]):disabled', 'color', 'rgba(171, 179, 191, 0.6)'],
    ['.bp6-button.bp6-intent-primary', 'background-color', '#4b456e'],
    ['.bp6-button.bp6-intent-warning', 'background-color', '#fbb360'],
    ['.bp6-button.bp6-intent-warning', 'color', '#343434'],
    [
        '.bp6-button.bp6-intent-warning:not(.bp6-disabled):not(.bp6-minimal):not(.bp6-outlined):hover',
        'background',
        '#ec9a3c',
    ],
    ['.bp6-dark .bp6-button.bp6-minimal', 'background', '#343434'],
    ['.bp6-dark .bp6-button.bp6-minimal', 'color', '#ffffff'],
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-primary', 'color', '#bcb3f7'],
    ['.bp6-dark .bp6-button.bp6-outlined', 'border-color', 'rgba(255, 255, 255, 0.4)'],
    ['.bp6-dark .bp6-html-select select', 'background-color', '#343434'],
    ['.bp6-dark .bp6-input:disabled', 'color', 'rgba(171, 179, 191, 0.6)'],
    [
        '.bp6-dark .bp6-input.bp6-intent-primary',
        'box-shadow',
        `0 0 0 0 rgba(76, 144, 240, 0), 0 0 0 0 rgba(76, 144, 240, 0), inset 0 0 0 1px #4c90f0, ${DARK_INPUT_SHADOW}`,
    ],
    ['.bp6-dark .bp6-input-group.bp6-intent-primary > .bp6-icon', 'color', '#bcb3f7'],
    ['.bp6-dark .bp6-tag.bp6-minimal.bp6-intent-primary', 'color', '#8abbff'],
    ['.bp6-dark .bp6-tag.bp6-minimal.bp6-intent-warning', 'color', '#fbb360'],
    ['.bp6-dark .bp6-card', 'box-shadow', 'inset 0 0 0 1px rgba(255, 255, 255, 0.2)'],
    ['.bp6-dark .bp6-elevation-3', 'box-shadow', `inset 0 0 0 1px rgba(255, 255, 255, 0.2), ${DARK_DROP_SHADOW_3}`],
    ['.bp6-dark .bp6-dialog', 'box-shadow', `inset 0 0 0 1px rgba(255, 255, 255, 0.2), ${DARK_DROP_SHADOW_3}`],
    [
        '.bp6-dark .bp6-popover',
        'box-shadow',
        `0 0 0 1px hsl(215, 3%, 38%), inset 0 0 0 1px rgba(255, 255, 255, 0.2), ${DARK_DROP_SHADOW_3}`,
    ],
];

describe('Blueprint 6.6 dark-theme parity', () => {
    it.each(BLUEPRINT_6_6_VALUES)('%s keeps its 6.6 %s', (selector, property, expected) => {
        expect(winningDeclaration(selector, property)?.value).toBe(expected);
    });

    it('keeps segmented control buttons after the minimal button rules they won ties against in 6.6', () => {
        const segmentedControl = winningDeclaration(
            '.bp6-dark .bp6-segmented-control > .bp6-button.bp6-minimal',
            'color',
        );
        const minimalHover = winningDeclaration('.bp6-dark .bp6-button.bp6-minimal:hover', 'color');

        expect(segmentedControl).toBeDefined();
        expect(minimalHover).toBeDefined();
        expect(segmentedControl!.order).toBeGreaterThan(minimalHover!.order);
    });

    it('only references --bp-* design tokens that Blueprint still defines', () => {
        const referenced = new Set(
            STYLESHEETS.flatMap((path) =>
                [...readFileSync(join(ROOT, path), 'utf8').matchAll(/var\((--bp-[a-z0-9-]+)\)/g)].map(
                    ([, token]) => token,
                ),
            ),
        );

        expect(referenced.size).toBeGreaterThan(0);

        for (const token of referenced) {
            expect(css, `${token} is no longer defined`).toMatch(new RegExp(`${token}\\s*:`));
        }
    });
});
