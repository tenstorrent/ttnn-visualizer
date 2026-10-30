// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compile } from 'sass';
import { describe, expect, it } from 'vitest';
// @ts-expect-error don't have types declaration for sassOptions
import { createSassOptions } from '../src/libs/blueprintjs/sassOptions';

// The app themes Blueprint through its --bp-* design tokens plus a short list of overrides in _blueprintjs.scss.
// These checks pin those values in the CSS Vite builds, so a Blueprint upgrade that redeclares a token later, or
// changes what wins for an overridden selector, fails here instead of silently changing the app's colours. They read
// the last rule declaring a property for an exact selector, which is what wins between rules of equal specificity;
// they cannot see a Blueprint rule that wins by specificity.

const ROOT = resolve(__dirname, '..');
const STYLESHEET = 'src/scss/_blueprintjs.scss';

// Blueprint and our partials quote attribute values differently, which does not change what they match
const normaliseSelector = (selector: string) =>
    selector
        .replace(/\s+/g, ' ')
        .replace(/=(["'])([^"']*)\1/g, '=$2')
        .trim();

// The same options Vite builds with, so these checks see the CSS that ships
const compileBlueprintStyles = () => compile(join(ROOT, STYLESHEET), createSassOptions(ROOT)).css;

// Sass wraps long values over several lines, which does not change them
const normaliseValue = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Every top-level declaration value, keyed by `selector|property`, keeping only the last one in source order. */
const indexDeclarations = (css: string) => {
    const valueBySelectorProperty = new Map<string, string>();
    const openSelectors: string[] = [];

    for (const [, text, brace] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)([{}])/g)) {
        if (brace === '{') {
            openSelectors.push(text.trim());
        } else {
            const selectorList = openSelectors.pop() ?? '';
            const isTopLevelRule = selectorList !== '' && !selectorList.startsWith('@') && openSelectors.length === 0;

            if (isTopLevelRule) {
                text.split(';')
                    .filter((declaration) => declaration.includes(':'))
                    .forEach((declaration) => {
                        const colon = declaration.indexOf(':');
                        const property = declaration.slice(0, colon).trim();
                        const value = normaliseValue(declaration.slice(colon + 1));

                        selectorList.split(',').forEach((selector) => {
                            valueBySelectorProperty.set(`${normaliseSelector(selector)}|${property}`, value);
                        });
                    });
            }
        }
    }

    return valueBySelectorProperty;
};

const css = compileBlueprintStyles();
const valueBySelectorProperty = indexDeclarations(css);

const winningValue = (selector: string, property: string) =>
    valueBySelectorProperty.get(`${normaliseSelector(selector)}|${property}`);

const DARK_BORDER_SHADOW = 'inset 0 0 0 1px rgba(255, 255, 255, 0.2)';
const DARK_DROP_SHADOW = 'rgba(17, 20, 24, 0.4)';

// [token, value], set on :root because Blueprint declares the intent tokens there
const ROOT_TOKENS: [string, string][] = [
    ['--bp-intent-primary-rest', '#4b456e'],
    ['--bp-intent-primary-hover', 'rgb(25.2218205718%, 23.2040749261%, 36.9920035053%)'],
    ['--bp-intent-primary-active', 'rgb(21.0318764377%, 19.3493263227%, 30.8467521087%)'],
    ['--bp-intent-primary-foreground', '#ffffff'],
    ['--bp-intent-success-rest', '#32a467'],
    ['--bp-intent-success-hover', '#238551'],
    ['--bp-intent-success-active', '#1c6e42'],
    ['--bp-intent-success-foreground', '#ffffff'],
    ['--bp-intent-warning-rest', '#f6bc42'],
    ['--bp-intent-warning-hover', '#8b7039'],
    ['--bp-intent-warning-active', '#8b7039'],
    ['--bp-intent-warning-foreground', '#343434'],
    ['--bp-intent-danger-rest', '#fa512e'],
    ['--bp-intent-danger-hover', 'rgb(97.8055708265%, 23.6338647609%, 8.2728605461%)'],
    ['--bp-intent-danger-active', '#8d2914'],
    ['--bp-intent-danger-foreground', '#ffffff'],
    ['--bp6-button-warning-rest', '#f6bc42'],
];

// [token, value], set on .bp6-dark because Blueprint declares the dark values there
const DARK_TOKENS: [string, string][] = [
    ['--bp-typography-color-default-rest', '#fff'],
    ['--bp-typography-color-default-disabled', 'rgba(171, 179, 191, 0.6)'],
    ['--bp-surface-shadow-0', DARK_BORDER_SHADOW],
    ['--bp-surface-shadow-1', `${DARK_BORDER_SHADOW}, 0 1px 1px ${DARK_DROP_SHADOW}`],
    ['--bp-surface-shadow-2', `${DARK_BORDER_SHADOW}, 0 1px 1px ${DARK_DROP_SHADOW}, 0 2px 6px ${DARK_DROP_SHADOW}`],
    ['--bp-surface-shadow-3', `${DARK_BORDER_SHADOW}, 0 2px 4px ${DARK_DROP_SHADOW}, 0 8px 24px ${DARK_DROP_SHADOW}`],
    [
        '--bp-surface-shadow-4',
        `${DARK_BORDER_SHADOW}, 0 4px 8px ${DARK_DROP_SHADOW}, 0 18px 46px 6px ${DARK_DROP_SHADOW}`,
    ],
];

// [selector, property, value] for the colours that come from configured Blueprint Sass or app overrides
const OVERRIDDEN_VALUES: [string, string, string][] = [
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-primary:hover', 'color', '#e2defc'],
    [
        '.bp6-dark .bp6-button.bp6-minimal.bp6-intent-primary:hover',
        'background-color',
        'color-mix(in oklch, #bcb3f7 20%, transparent)',
    ],
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-primary.bp6-active', 'color', '#e2defc'],
    ['.bp6-dark .bp6-button.bp6-outlined.bp6-intent-primary:hover:not(:disabled)', 'color', '#bcb3f7'],
    ['.bp6-dark .bp6-button.bp6-outlined.bp6-intent-primary:active:not(:disabled)', 'color', '#bcb3f7'],
    ['.bp6-dark .bp6-button.bp6-outlined.bp6-intent-primary.bp6-active', 'color', '#bcb3f7'],
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-success.bp6-active', 'color', '#72ca9b'],
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-warning.bp6-active', 'color', '#f9d68e'],
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-danger.bp6-active', 'color', '#ff9e8a'],
    ['.bp6-dark .bp6-tag.bp6-minimal.bp6-intent-primary', 'color', '#bcb3f7'],
    ['.bp6-dark .bp6-tag.bp6-minimal.bp6-intent-success', 'color', '#72ca9b'],
    ['.bp6-dark .bp6-tag.bp6-minimal.bp6-intent-warning', 'color', '#f6bc42'],
    ['.bp6-dark .bp6-tag.bp6-minimal.bp6-intent-danger', 'color', '#ff9e8a'],
    ['.bp6-tag.bp6-intent-warning', 'background', 'var(--bp-intent-warning-rest)'],
    // Still read from Sass in Blueprint 6.21, so a release that moves them onto tokens would silently drop them
    ['.bp6-dark a', 'color', '#3eb7de'],
    ['.bp6-control input:checked ~ .bp6-control-indicator', 'background-color', '#3eb7de'],
    ['.bp6-dark .bp6-control.bp6-switch input:checked ~ .bp6-control-indicator', 'background', '#3eb7de'],
    ['.bp6-dark .bp6-progress-bar', 'background', '#0d4d62'],
    ['.bp6-dark .bp6-progress-bar .bp6-progress-meter', 'background-color', '#3eb7de'],
    // Blueprint 6.7+ only matches an icon that is a direct child, so an icon wrapped in a Tooltip target lost this
    [
        '.bp6-button .bp6-icon:first-child:last-child',
        'margin',
        '0 calc(-1 * (var(--bp-surface-spacing) * 7.5 - var(--bp-surface-spacing) * 4) * 0.5)',
    ],
];

// The token overrides and configured maps were checked against this release
const CHECKED_BLUEPRINT_CORE = '6.21';

/** The value of the last declaration of a custom property anywhere in the CSS, including inside @supports. */
const lastTokenValue = (token: string) => {
    const values = [...css.matchAll(new RegExp(`${token}\\s*:\\s*([^;}]+)`, 'g'))].map(([, value]) =>
        normaliseValue(value),
    );

    return values.at(-1);
};

describe('Blueprint theme', () => {
    it(`was checked against the installed @blueprintjs/core (${CHECKED_BLUEPRINT_CORE})`, () => {
        const { version } = JSON.parse(
            readFileSync(join(ROOT, 'node_modules/@blueprintjs/core/package.json'), 'utf8'),
        ) as { version: string };

        expect(
            version.split('.').slice(0, 2).join('.'),
            'Blueprint changed: re-check the token overrides and maps in src/scss/_blueprintjs.scss, then update this version',
        ).toBe(CHECKED_BLUEPRINT_CORE);
    });

    it.each(ROOT_TOKENS)(':root sets %s to %s', (token, expected) => {
        expect(winningValue(':root', token)).toBe(expected);
    });

    it.each(DARK_TOKENS)('.bp6-dark sets %s to %s', (token, expected) => {
        expect(winningValue('.bp6-dark', token)).toBe(expected);
    });

    // Blueprint redeclares some tokens inside @supports blocks, which the selector index does not see
    it.each([...ROOT_TOKENS, ...DARK_TOKENS])(
        'declares %s after any Blueprint declaration of it',
        (token, expected) => {
            expect(lastTokenValue(token)).toBe(expected);
        },
    );

    // A token Blueprint stops reading, such as the private --bp6-button-warning-rest, would otherwise pass every
    // check above while changing nothing
    it.each([...ROOT_TOKENS, ...DARK_TOKENS])('%s is still read by Blueprint', (token) => {
        expect(css).toMatch(new RegExp(`var\\(${token}[,)]`));
    });

    it.each(OVERRIDDEN_VALUES)('%s keeps its %s', (selector, property, expected) => {
        expect(winningValue(selector, property)).toBe(expected);
    });

    it('only references --bp-* design tokens that Blueprint still defines', () => {
        const referenced = new Set(
            [...readFileSync(join(ROOT, STYLESHEET), 'utf8').matchAll(/var\((--bp-[a-z0-9-]+)\)/g)].map(
                ([, token]) => token,
            ),
        );

        expect(referenced.size).toBeGreaterThan(0);

        for (const token of referenced) {
            expect(css, `${token} is no longer defined`).toMatch(new RegExp(`${token}\\s*:`));
        }
    });
});
