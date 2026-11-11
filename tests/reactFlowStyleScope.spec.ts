// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompiledRule, getCompiledRules, getCompiledStylesheet, getStylesheet } from './helpers/stylesheets';

// React Flow puts `.react-flow*` classes on every flow instance, so a rule that
// starts its selector with one styles every graph in the app. Each view scopes
// its rules under its own root; only the shared theme is app-wide. #1899
const SHARED_THEME = 'src/scss/_reactFlow.scss';
const MLIR_SHEET = 'src/scss/components/MLIRViewReactFlow.scss';
const OP_GRAPH_SHEET = 'src/scss/components/OperationGraphReactFlow.scss';
const SCANNED_DIRECTORIES = ['src/scss', 'src/components'];

const CONTROLS_THEME_VARIABLES = [
    '--xy-controls-button-color',
    '--xy-controls-button-color-hover',
    '--xy-controls-button-background-color-hover',
];

const getScssFiles = (directory: string): string[] =>
    readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return getScssFiles(path);
        }
        return entry.name.endsWith('.scss') && !entry.name.startsWith('_') ? [path] : [];
    });

const getSelectors = (rules: CompiledRule[]): string[] => rules.flatMap((rule) => rule.selectors);

// The first compound selector, e.g. `.react-flow__node.selected` from
// `.react-flow__node.selected > .label`.
const getFirstCompound = (selector: string): string => selector.split(/\s*[\s>+~]\s*/)[0];

const PANEL_BOTTOM_LEFT = /\.react-flow__panel\.bottom\.left\b/;

describe('React Flow stylesheet scoping', () => {
    it('keeps every view stylesheet off an unscoped React Flow selector', () => {
        const files = SCANNED_DIRECTORIES.flatMap(getScssFiles);
        expect(files).toContain(MLIR_SHEET);

        const offenders = files.flatMap((file) =>
            getSelectors(getCompiledRules(getCompiledStylesheet(file)))
                .filter((selector) => getFirstCompound(selector).startsWith('.react-flow'))
                .map((selector) => `${relative('.', file)}: ${selector}`),
        );

        expect(offenders).toEqual([]);
    });

    it('scopes every React Flow selector in the MLIR sheet to the MLIR page', () => {
        const reactFlowSelectors = getSelectors(getCompiledRules(getCompiledStylesheet(MLIR_SHEET))).filter(
            (selector) => selector.includes('react-flow'),
        );
        expect(reactFlowSelectors.length).toBeGreaterThan(0);

        // A selector anchored on an app-owned `mlir-` class is already scoped,
        // e.g. `.mlir-group-handle-port.react-flow__handle`.
        const unscoped = reactFlowSelectors.filter(
            (selector) => !selector.startsWith(':where(.mlir-page) ') && !/^\.mlir-/.test(getFirstCompound(selector)),
        );
        expect(unscoped).toEqual([]);
    });

    it('docks the operation graph bottom-left panels from its own sheet', () => {
        const dockRules = getCompiledRules(getCompiledStylesheet(OP_GRAPH_SHEET)).filter((rule) =>
            rule.selectors.some((selector) => PANEL_BOTTOM_LEFT.test(selector)),
        );
        expect(dockRules.flatMap((rule) => rule.selectors)).toEqual([
            '.operation-graph-react-flow .react-flow__panel.bottom.left',
        ]);
        expect(dockRules[0].body).toMatch(/\bleft:\s*12px;/);
        expect(dockRules[0].body).toMatch(/margin-bottom:\s*\d+px;/);
    });

    it('confines the MLIR bottom-left panel offsets to the MLIR page', () => {
        const panelSelectors = getSelectors(getCompiledRules(getCompiledStylesheet(MLIR_SHEET))).filter((selector) =>
            PANEL_BOTTOM_LEFT.test(selector),
        );
        expect(panelSelectors).toEqual([':where(.mlir-page) .react-flow .react-flow__panel.bottom.left']);
    });

    it('themes the shared Controls from the app-wide partial, below the props tier', () => {
        const rules = getCompiledRules(getCompiledStylesheet(SHARED_THEME));
        expect(rules.map((rule) => rule.selectors)).toEqual([['.react-flow']]);

        const { body } = rules[0];
        CONTROLS_THEME_VARIABLES.forEach((variable) => expect(body).toMatch(new RegExp(`${variable}:`)));
        // The `-props` tier is React Flow's own for component props; setting it
        // here would stop a `<Controls>` prop from overriding the theme.
        expect(body).not.toContain('-props');

        expect(getStylesheet('src/index.scss')).toMatch(/^@use 'scss\/reactFlow';$/m);
    });
});
