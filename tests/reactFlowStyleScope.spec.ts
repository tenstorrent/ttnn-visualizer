// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompiledRule, getCompiledRules, getCompiledStylesheet } from './helpers/compiledStylesheets';
import { getStylesheet } from './helpers/stylesheets';

// React Flow puts `.react-flow*` classes on every flow instance, so a rule that
// names one without a view root styles every graph in the app. Each view scopes
// its rules under its own root; only the shared theme is app-wide. #1899
const SHARED_THEME = 'src/scss/_reactFlow.scss';
const MLIR_SHEET = 'src/scss/components/MLIRViewReactFlow.scss';
const OP_GRAPH_SHEET = 'src/scss/components/OperationGraphReactFlow.scss';
const APP_ENTRY = 'src/index.scss';

const OP_GRAPH_ROOT = '.operation-graph-react-flow';
const MLIR_ROOT = ':where(.mlir-view-pane)';
const VIEW_ROOTS = [OP_GRAPH_ROOT, MLIR_ROOT];

const CONTROLS_THEME_VARIABLES = [
    '--xy-controls-button-color',
    '--xy-controls-button-color-hover',
    '--xy-controls-button-background-color-hover',
];

// Partials too: `index.scss` loads them app-wide.
const getScssFiles = (directory: string): string[] =>
    readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return getScssFiles(path);
        }
        return entry.name.endsWith('.scss') ? [path] : [];
    });

const getSelectors = (rules: CompiledRule[]): string[] => rules.flatMap((rule) => rule.selectors);

// The first compound selector, e.g. `.react-flow__node.selected` from
// `.react-flow__node.selected > .label`.
const getFirstCompound = (selector: string): string => selector.split(/\s*[\s>+~]\s*/)[0];

// A React Flow class, such as `.react-flow` or `.react-flow__node`. The dot
// keeps out app classes that end in `-react-flow`.
const REACT_FLOW_CLASS = /\.react-flow/;

const opensWithRoot = (selector: string, root: string): boolean => {
    const firstCompound = getFirstCompound(selector);
    return firstCompound.startsWith(root) && !/^[\w-]/.test(firstCompound.slice(root.length));
};

// An app-owned `mlir-` class in the same compound as the React Flow class,
// e.g. `.mlir-group-handle-port.react-flow__handle`.
const isAnchoredOnMlirClass = (selector: string): boolean => {
    const firstCompound = getFirstCompound(selector);
    return /^\.mlir-/.test(firstCompound) && REACT_FLOW_CLASS.test(firstCompound);
};

const PANEL_BOTTOM_LEFT = /\.react-flow__panel\.bottom\.left\b/;

// A blank line, a line comment or an `@use`: everything the app entry may hold.
const APP_ENTRY_LINE = /^(?:\/\/.*|@use '[^']+';)?$/;

describe('React Flow stylesheet scoping', () => {
    // The theme is exempt by path, not by selector, so a bare `.react-flow`
    // rule in any other sheet still fails.
    it('opens every React Flow selector with a view root, outside the shared theme', () => {
        const files = getScssFiles('src/scss');
        expect(files).toContain(MLIR_SHEET);
        expect(files).toContain(SHARED_THEME);

        const offenders = files
            .filter((file) => file !== SHARED_THEME)
            .flatMap((file) =>
                getSelectors(getCompiledRules(getCompiledStylesheet(file)))
                    .filter((selector) => REACT_FLOW_CLASS.test(selector))
                    .filter(
                        (selector) =>
                            !VIEW_ROOTS.some((root) => opensWithRoot(selector, root)) &&
                            !isAnchoredOnMlirClass(selector),
                    )
                    .map((selector) => `${file}: ${selector}`),
            );

        expect(offenders).toEqual([]);
    });

    // The app entry compiles the theme in, so it is not scanned above. It may
    // only load sheets, each of which is scanned on its own.
    it('adds no rules of its own in the app entry', () => {
        const extraLines = getStylesheet(APP_ENTRY)
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => !APP_ENTRY_LINE.test(line));

        expect(extraLines).toEqual([]);
    });

    it('scopes every React Flow selector in the MLIR sheet to the MLIR view pane', () => {
        const reactFlowSelectors = getSelectors(getCompiledRules(getCompiledStylesheet(MLIR_SHEET))).filter(
            (selector) => REACT_FLOW_CLASS.test(selector),
        );
        expect(reactFlowSelectors.length).toBeGreaterThan(0);

        const unscoped = reactFlowSelectors.filter(
            (selector) => !selector.startsWith(`${MLIR_ROOT} `) && !isAnchoredOnMlirClass(selector),
        );
        expect(unscoped).toEqual([]);
    });

    it('docks the operation graph bottom-left panels from its own sheet', () => {
        const dockRules = getCompiledRules(getCompiledStylesheet(OP_GRAPH_SHEET)).filter((rule) =>
            rule.selectors.some((selector) => PANEL_BOTTOM_LEFT.test(selector)),
        );
        expect(dockRules.flatMap((rule) => rule.selectors)).toEqual([
            `${OP_GRAPH_ROOT} .react-flow__panel.bottom.left`,
        ]);
        // Anchored on a declaration boundary, so `margin-left: 12px` does not count.
        expect(dockRules[0].body).toMatch(/(?:^|[;{\s])left:\s*12px;/);
        expect(dockRules[0].body).toMatch(/margin-bottom:\s*\d+px;/);
    });

    it('confines the MLIR bottom-left panel offsets to the MLIR view pane', () => {
        const panelSelectors = getSelectors(getCompiledRules(getCompiledStylesheet(MLIR_SHEET))).filter((selector) =>
            PANEL_BOTTOM_LEFT.test(selector),
        );
        expect(panelSelectors).toEqual([`${MLIR_ROOT} .react-flow .react-flow__panel.bottom.left`]);
    });

    it('themes the shared Controls from the app-wide partial, below the props tier', () => {
        const rules = getCompiledRules(getCompiledStylesheet(SHARED_THEME));
        expect(rules.map((rule) => rule.selectors)).toEqual([['.react-flow']]);

        const { body } = rules[0];
        CONTROLS_THEME_VARIABLES.forEach((variable) => expect(body).toMatch(new RegExp(`${variable}:`)));
        // React Flow reads `-props` before the unsuffixed variable, so a `-props`
        // value here would inherit down and shadow a view's own override nearer
        // the Controls.
        expect(body).not.toContain('-props');

        expect(getStylesheet(APP_ENTRY)).toMatch(/^@use 'scss\/reactFlow';$/m);
    });
});
