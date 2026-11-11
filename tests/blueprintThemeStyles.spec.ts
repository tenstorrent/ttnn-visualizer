// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compile, compileString } from 'sass';
import { describe, expect, it } from 'vitest';
// @ts-expect-error don't have types declaration for sassOptions
import { createSassOptions } from '../src/libs/blueprintjs/sassOptions';

// The app themes Blueprint through its --bp-* design tokens plus a short list of overrides in _blueprintjs.scss.
// These checks pin those values in the CSS Vite builds, so a Blueprint upgrade that redeclares a token on a more
// specific selector, or changes what wins for an overridden selector, fails here instead of silently changing the
// app's colours. They read the last rule declaring a property for an exact selector, which is what wins between rules
// of equal specificity; they cannot see a Blueprint rule that wins by specificity.

const ROOT = resolve(__dirname, '..');
const STYLESHEET = 'src/scss/_blueprintjs.scss';

// Blueprint and our partials quote attribute values differently, which does not change what they match
const normaliseSelector = (selector: string) =>
    selector
        .replace(/\s+/g, ' ')
        .replace(/=(["'])([^"']*)\1/g, '=$2')
        .trim();

/** The selectors in a selector list, splitting only on commas outside :where(), :not() and other brackets. */
const splitSelectorList = (selectorList: string) => {
    const selectors: string[] = [];
    let depth = 0;
    let start = 0;

    [...selectorList].forEach((character, index) => {
        if (character === '(') {
            depth += 1;
        } else if (character === ')') {
            depth -= 1;
        } else if (character === ',' && depth === 0) {
            selectors.push(selectorList.slice(start, index));
            start = index + 1;
        }
    });

    return [...selectors, selectorList.slice(start)];
};

// The same options Vite builds with, so these checks see the CSS that ships
const SASS_OPTIONS = createSassOptions(ROOT);

// Sass wraps long values over several lines, which does not change them
const normaliseValue = (value: string) => value.replace(/\s+/g, ' ').trim();

/** The rules of a stylesheet as [selector list, declarations, enclosing at-rules], without comments or @charset. */
const readRules = (source: string) => {
    const rules: [string, string, string[]][] = [];
    const openSelectors: string[] = [];

    for (const [, text, brace] of source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/@charset[^;]*;/, '')
        .matchAll(/([^{}]*)([{}])/g)) {
        if (brace === '{') {
            openSelectors.push(text.trim());
        } else {
            const selectorList = openSelectors.pop() ?? '';

            if (selectorList !== '' && !selectorList.startsWith('@')) {
                rules.push([selectorList, text, [...openSelectors]]);
            }
        }
    }

    return rules;
};

/** Every top-level declaration value, keyed by `selector|property`, keeping only the last one in source order. */
const indexDeclarations = (source: string) => {
    const valueBySelectorProperty = new Map<string, string>();

    readRules(source)
        .filter(([, , atRules]) => atRules.length === 0)
        .forEach(([selectorList, text]) => {
            text.split(';')
                .filter((declaration) => declaration.includes(':'))
                .forEach((declaration) => {
                    const colon = declaration.indexOf(':');
                    const property = declaration.slice(0, colon).trim();
                    const value = normaliseValue(declaration.slice(colon + 1));

                    splitSelectorList(selectorList).forEach((selector) => {
                        valueBySelectorProperty.set(`${normaliseSelector(selector)}|${property}`, value);
                    });
                });
        });

    return valueBySelectorProperty;
};

/** The selector of each rule declaring the custom property, once per rule, including rules nested in @supports. */
const declarationSelectors = (source: string, token: string) => {
    const declaration = new RegExp(`(?<![\\w-])${token}\\s*:`);

    return readRules(source)
        .filter(([, text]) => declaration.test(text))
        .flatMap(([selectorList]) => splitSelectorList(selectorList).map(normaliseSelector));
};

/** Every selector with a rule declaring the custom property, including rules nested in @supports. */
const selectorsDeclaring = (source: string, token: string) => [...new Set(declarationSelectors(source, token))];

const { css } = compile(join(ROOT, STYLESHEET), SASS_OPTIONS);

// Blueprint's own CSS, without our configuration or tokens, so a check against it cannot pass on our output alone:
// our tag maps also read the intent tokens, and our :root block declares them
const stockBlueprintCss = compileString("@use '@blueprintjs/core/src/blueprint.scss';", SASS_OPTIONS).css;
const valueBySelectorProperty = indexDeclarations(css);
const stockValueBySelectorProperty = indexDeclarations(stockBlueprintCss);

const winningValue = (selector: string, property: string) =>
    valueBySelectorProperty.get(`${normaliseSelector(selector)}|${property}`);

const stockWinningValue = (selector: string, property: string) =>
    stockValueBySelectorProperty.get(`${normaliseSelector(selector)}|${property}`);

/** The selectors our stylesheet declares the custom property on, beyond the declarations Blueprint makes itself. */
const addedDeclarationSelectors = (token: string) => {
    const unmatchedStock = declarationSelectors(stockBlueprintCss, token);

    return declarationSelectors(css, token).filter((selector) => {
        const stockIndex = unmatchedStock.indexOf(selector);

        if (stockIndex === -1) {
            return true;
        }

        unmatchedStock.splice(stockIndex, 1);

        return false;
    });
};

const DARK_BORDER_SHADOW = 'inset 0 0 0 1px rgba(255, 255, 255, 0.2)';
const DARK_DROP_SHADOW = 'rgba(17, 20, 24, 0.4)';
const DARK_FOCUS_RING = 'rgba(138, 187, 255, 0.752)';
const DARK_INPUT_BOX_SHADOW = `${DARK_BORDER_SHADOW}, inset 0 -1px 1px 0 rgba(255, 255, 255, 0.3)`;
const DARK_INPUT_FOCUS_SHADOW = `inset 0 0 0 1px ${DARK_FOCUS_RING}, 0 0 0 1px ${DARK_FOCUS_RING}`;

/**
 * A palette shade adjusted in Sass, as Sass prints it. Sass prints adjusted colours with fractional channels, so
 * pinning the printed value would fail on a Sass upgrade that only changes the printing.
 */
const adjustedShade = (colour: string, lightness: string) =>
    compileString(
        `@use 'sass:color'; @use 'definitions/colours' as *; a { b: color.adjust(${colour}, $lightness: ${lightness}); }`,
        { ...SASS_OPTIONS, loadPaths: [...SASS_OPTIONS.loadPaths, join(ROOT, 'src/scss')] },
    ).css.match(/b:\s*([^;]+);/)![1];

const DEFAULT_BUTTON_HOVER = adjustedShade('$tt-grey-2', '-5%');
const MINIMAL_BUTTON_HOVER = adjustedShade('$tt-grey-2', '5%');
const NOT_PRESSED = ':where(:not(:active, .bp6-active))';
const NOT_DISABLED_OR_PRESSED = ':where(:not(:disabled, .bp6-disabled, :active, .bp6-active))';
const SPINNER_HEAD = '.bp6-button-spinner .bp6-spinner-head';

// [token, value], set on :root because Blueprint declares the intent tokens there
const ROOT_TOKENS: [string, string][] = [
    ['--bp-intent-primary-rest', '#4b456e'],
    ['--bp-intent-primary-hover', adjustedShade('$tt-purple-shade', '-5%')],
    ['--bp-intent-primary-active', adjustedShade('$tt-purple-shade', '-10%')],
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
    ['--bp-intent-danger-hover', adjustedShade('$tt-red-accent', '-5%')],
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

const ALL_TOKENS = [...ROOT_TOKENS, ...DARK_TOKENS];

// Blueprint declares the dark tokens on these, and our .bp6-dark values only win against them
const DARK_TOKEN_SELECTORS = [':root', '.bp6-dark', '[data-bp-color-scheme=dark]'];

// [selector, property, value] for the colours that come from configured Blueprint Sass or app overrides
const OVERRIDDEN_VALUES: [string, string, string][] = [
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-primary', 'color', '#bcb3f7'],
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-success', 'color', '#32a467'],
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-warning', 'color', '#f6bc42'],
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-danger', 'color', '#fa512e'],
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
    ['.bp6-tag.bp6-intent-success', 'background', '#238551'],
    ['.bp6-tag.bp6-intent-success.bp6-interactive:hover', 'background-color', '#1c6e42'],
    ['.bp6-tag.bp6-intent-success.bp6-interactive:active', 'background-color', '#165a36'],
    ['.bp6-dark .bp6-input:focus', 'box-shadow', DARK_INPUT_FOCUS_SHADOW],
    ['.bp6-dark .bp6-input[readonly]:focus', 'box-shadow', DARK_INPUT_FOCUS_SHADOW],
    ['.bp6-dark .bp6-file-upload-input:focus', 'box-shadow', DARK_INPUT_FOCUS_SHADOW],
    [
        '.bp6-dark .bp6-file-input input:focus + .bp6-file-upload-input',
        'box-shadow',
        `${DARK_INPUT_FOCUS_SHADOW}, ${DARK_INPUT_BOX_SHADOW}`,
    ],
    ['.bp6-dark .bp6-input-group.bp6-intent-primary > .bp6-icon', 'color', '#bcb3f7'],
    ['.bp6-dark .bp6-input-group.bp6-intent-primary .bp6-input[readonly]', 'box-shadow', 'inset 0 0 0 1px #bcb3f7'],
    ['.bp6-dark .bp6-input-group.bp6-intent-success > .bp6-icon', 'color', '#32a467'],
    ['.bp6-dark .bp6-input-group.bp6-intent-success .bp6-input[readonly]', 'box-shadow', 'inset 0 0 0 1px #32a467'],
    ['.bp6-dark .bp6-input-group.bp6-intent-warning > .bp6-icon', 'color', '#f6bc42'],
    ['.bp6-dark .bp6-input-group.bp6-intent-warning .bp6-input[readonly]', 'box-shadow', 'inset 0 0 0 1px #f6bc42'],
    ['.bp6-dark .bp6-input-group.bp6-intent-danger > .bp6-icon', 'color', '#fa512e'],
    ['.bp6-dark .bp6-input-group.bp6-intent-danger .bp6-input[readonly]', 'box-shadow', 'inset 0 0 0 1px #fa512e'],
    [
        '.bp6-dark .bp6-input.bp6-intent-warning',
        'box-shadow',
        `inset 0 0 0 0 rgba(246, 188, 66, 0), 0 0 0 0 rgba(246, 188, 66, 0), inset 0 0 0 1px #f6bc42, ${DARK_INPUT_BOX_SHADOW}`,
    ],
    [
        '.bp6-dark .bp6-input-group.bp6-intent-warning .bp6-input:focus',
        'box-shadow',
        `inset 0 0 0 1px rgba(246, 188, 66, 0.752), 0 0 0 calc(var(--bp-surface-spacing) * 0.5) rgba(246, 188, 66, 0.752), ${DARK_INPUT_BOX_SHADOW}`,
    ],
    [
        '.bp6-dark .bp6-button:not([class*=bp6-intent-]):where(:not(.bp6-minimal, .bp6-outlined))',
        'background-color',
        '#343434',
    ],
    ['.bp6-dark .bp6-html-select select', 'background-color', '#343434'],
    ['.bp6-dark .bp6-file-upload-input::after', 'background-color', '#343434'],
    [
        '.bp6-dark .bp6-button:not([class*=bp6-intent-]):where(:not(.bp6-minimal, .bp6-outlined, :disabled, .bp6-disabled, :active, .bp6-active)):hover',
        'background-color',
        DEFAULT_BUTTON_HOVER,
    ],
    [`.bp6-dark .bp6-html-select select${NOT_DISABLED_OR_PRESSED}:hover`, 'background-color', DEFAULT_BUTTON_HOVER],
    ['.bp6-dark .bp6-file-upload-input:where(:not(:active)):hover::after', 'background-color', DEFAULT_BUTTON_HOVER],
    [`.bp6-dark .bp6-button.bp6-minimal${NOT_PRESSED}:hover`, 'background-color', MINIMAL_BUTTON_HOVER],
    [`.bp6-dark .bp6-button.bp6-outlined${NOT_PRESSED}:hover`, 'background-color', MINIMAL_BUTTON_HOVER],
    [
        `.bp6-dark .bp6-button-group.bp6-minimal .bp6-button${NOT_PRESSED}:hover`,
        'background-color',
        MINIMAL_BUTTON_HOVER,
    ],
    [
        `.bp6-dark .bp6-button-group.bp6-outlined .bp6-button${NOT_PRESSED}:hover`,
        'background-color',
        MINIMAL_BUTTON_HOVER,
    ],
    // Disabled minimal selects are left out: Blueprint has no :hover rule for them that would win by specificity
    [
        `.bp6-dark .bp6-html-select.bp6-minimal select${NOT_DISABLED_OR_PRESSED}:hover`,
        'background-color',
        MINIMAL_BUTTON_HOVER,
    ],
    [
        `.bp6-dark .bp6-select.bp6-minimal select${NOT_DISABLED_OR_PRESSED}:hover`,
        'background-color',
        MINIMAL_BUTTON_HOVER,
    ],
    [`.bp6-dark .bp6-button:not([class*=bp6-intent-]) ${SPINNER_HEAD}`, 'stroke', '#3eb7de'],
    [`.bp6-dark .bp6-button[class*=bp6-intent-] ${SPINNER_HEAD}`, 'stroke', '#3eb7de'],
    [`.bp6-dark .bp6-button.bp6-minimal.bp6-intent-success ${SPINNER_HEAD}`, 'stroke', '#32a467'],
    [`.bp6-dark .bp6-button.bp6-outlined.bp6-intent-primary ${SPINNER_HEAD}`, 'stroke', '#bcb3f7'],
    [`.bp6-dark .bp6-button-group.bp6-minimal .bp6-button.bp6-intent-warning ${SPINNER_HEAD}`, 'stroke', '#f6bc42'],
    [`.bp6-dark .bp6-button-group.bp6-outlined .bp6-button.bp6-intent-danger ${SPINNER_HEAD}`, 'stroke', '#fa512e'],
    ['.bp6-dark .bp6-input-group .bp6-icon', 'color', '#fff'],
    ['.bp6-dark .bp6-form-group.bp6-intent-primary .bp6-form-helper-text', 'color', '#bcb3f7'],
    ['.bp6-dark .bp6-form-group.bp6-intent-warning .bp6-form-helper-text', 'color', '#f6bc42'],
    ['.bp6-dark .bp6-form-group.bp6-intent-danger .bp6-form-helper-text', 'color', '#fa512e'],
    // Still read from Sass in Blueprint 6.21, so a release that moves them onto tokens would silently drop them
    ['.bp6-dark a', 'color', '#3eb7de'],
    ['.bp6-control input:checked ~ .bp6-control-indicator', 'background-color', '#3eb7de'],
    [
        '.bp6-control:hover input:checked ~ .bp6-control-indicator',
        'background-color',
        adjustedShade('$tt-teal-accent', '-3%'),
    ],
    [
        '.bp6-dark .bp6-control input:not(:disabled):active:checked ~ .bp6-control-indicator',
        'background-color',
        adjustedShade('$tt-teal-accent', '-6%'),
    ],
    ['.bp6-dark .bp6-control.bp6-switch input:checked ~ .bp6-control-indicator', 'background', '#3eb7de'],
    ['.bp6-dark .bp6-progress-bar', 'background', '#0d4d62'],
    ['.bp6-dark .bp6-progress-bar .bp6-progress-meter', 'background-color', '#3eb7de'],
    ['.bp6-dark .bp6-html-select .bp6-icon', 'color', '#fff'],
    ['.bp6-dark .bp6-navbar', 'background-color', 'transparent'],
    ['.bp6-dark .bp6-navbar', 'box-shadow', 'none'],
    ['.bp6-tooltip.bp6-intent-danger .bp6-popover-content', 'background', '#fa512e'],
    ['.bp6-dark .bp6-callout.bp6-intent-danger', 'color', '#fa512e'],
    [
        '.bp6-dark .bp6-dialog',
        'box-shadow',
        `${DARK_BORDER_SHADOW}, 0 2px 4px ${DARK_DROP_SHADOW}, 0 8px 24px ${DARK_DROP_SHADOW}`,
    ],
    [
        '.bp6-dark .bp6-button.bp6-minimal.bp6-intent-warning:hover',
        'background-color',
        'color-mix(in oklch, #f6bc42 20%, transparent)',
    ],
    // Blueprint 6.7+ only matches an icon that is a direct child, so an icon wrapped in a Tooltip target lost this
    [
        '.bp6-button .bp6-icon:first-child:last-child',
        'margin',
        '0 calc(-1 * (var(--bp-surface-spacing) * 7.5 - var(--bp-surface-spacing) * 4) * 0.5)',
    ],
];

// [selector, property] for entries our configured maps copy from Blueprint's own, which would otherwise stay at their
// 6.21 values if a Blueprint release changed them
const COPIED_FROM_BLUEPRINT: [string, string][] = [
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-default', 'color'],
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-default:hover', 'color'],
    ['.bp6-dark .bp6-button.bp6-minimal.bp6-intent-default:active', 'color'],
    ['.bp6-button.bp6-minimal.bp6-intent-default:hover', 'background-color'],
    ['.bp6-tag.bp6-intent-primary', 'background'],
    ['.bp6-tag.bp6-intent-primary.bp6-interactive:hover', 'background-color'],
    ['.bp6-tag.bp6-intent-primary.bp6-interactive:active', 'background-color'],
    ['.bp6-tag.bp6-intent-primary', 'color'],
    ['.bp6-tag.bp6-intent-danger', 'background'],
    ['.bp6-tag.bp6-intent-danger.bp6-interactive:hover', 'background-color'],
    ['.bp6-tag.bp6-intent-danger.bp6-interactive:active', 'background-color'],
];

// The token overrides and configured maps were checked against this release
const CHECKED_BLUEPRINT_CORE = '6.21';

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

    // Our values win by coming last, which only holds while Blueprint declares each token on a selector no more
    // specific than ours, including inside its @supports blocks
    it.each(ROOT_TOKENS)('Blueprint declares %s only on :root', (token) => {
        expect(selectorsDeclaring(stockBlueprintCss, token)).toEqual([':root']);
    });

    it.each(DARK_TOKENS)('Blueprint declares %s only on :root or the dark scheme', (token) => {
        const selectors = selectorsDeclaring(stockBlueprintCss, token);

        expect(selectors.length).toBeGreaterThan(0);
        expect(DARK_TOKEN_SELECTORS).toEqual(expect.arrayContaining(selectors));
    });

    // A duplicate declaration on another selector would change what wins without changing the values read above
    it.each(ROOT_TOKENS)('our stylesheet declares %s only on :root', (token) => {
        expect(addedDeclarationSelectors(token)).toEqual([':root']);
    });

    it.each(DARK_TOKENS)('our stylesheet declares %s only on .bp6-dark', (token) => {
        expect(addedDeclarationSelectors(token)).toEqual(['.bp6-dark']);
    });

    // A token Blueprint stops reading, such as the private --bp6-button-warning-rest, would otherwise pass every
    // check above while changing nothing
    it.each(ALL_TOKENS)('%s is still read by Blueprint', (token) => {
        expect(stockBlueprintCss).toMatch(new RegExp(`var\\(${token}[,)]`));
    });

    it.each(OVERRIDDEN_VALUES)('%s keeps its %s', (selector, property, expected) => {
        expect(winningValue(selector, property)).toBe(expected);
    });

    it.each(COPIED_FROM_BLUEPRINT)('%s %s still matches Blueprint', (selector, property) => {
        expect(stockWinningValue(selector, property)).toBeDefined();
        expect(winningValue(selector, property)).toBe(stockWinningValue(selector, property));
    });

    it('only references --bp-* design tokens that Blueprint still defines', () => {
        const referenced = new Set(
            [...readFileSync(join(ROOT, STYLESHEET), 'utf8').matchAll(/var\((--bp-[a-z0-9-]+)[,)]/g)].map(
                ([, token]) => token,
            ),
        );

        expect(referenced.size).toBeGreaterThan(0);

        for (const token of referenced) {
            expect(stockBlueprintCss, `${token} is no longer defined`).toMatch(new RegExp(`${token}\\s*:`));
        }
    });
});
