// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Asserted against the stylesheet text because jsdom does not compile SCSS.
// Anchored on the cwd rather than `import.meta.url`, which jsdom serves over http.
const read = (path: string): string => readFileSync(resolve(process.cwd(), path), { encoding: 'utf8' });

const COMPONENTS_DIR = 'src/scss/components';

const ruleBody = (stylesheet: string, selector: string): string => {
    const start = stylesheet.indexOf(selector);
    expect(start, `${selector} not found`).toBeGreaterThan(-1);
    const open = stylesheet.indexOf('{', start);
    return stylesheet.slice(open + 1, stylesheet.indexOf('}', open));
};

describe('React Flow stylesheet scoping', () => {
    // `.react-flow` is on every flow instance, so a component sheet that opens a
    // rule with it styles every graph in the app, not just its own. #1899
    it('keeps every component sheet off a bare top-level `.react-flow`', () => {
        const offenders = readdirSync(resolve(process.cwd(), COMPONENTS_DIR))
            .filter((file) => file.endsWith('.scss'))
            .filter((file) => /^\.react-flow/m.test(read(`${COMPONENTS_DIR}/${file}`)));

        expect(offenders).toEqual([]);
    });

    it('docks the operation graph bottom-left panels itself rather than inheriting another view', () => {
        const body = ruleBody(
            read(`${COMPONENTS_DIR}/OperationGraphReactFlow.scss`),
            '    .react-flow__panel.bottom.left {',
        );

        expect(body).toMatch(/\bleft:\s*variables\.\$reactflow-panel-origin-left;/);
        expect(body).toMatch(/margin-bottom:/);
    });

    it('themes the shared Controls from the app-wide partial', () => {
        expect(read('src/scss/_reactFlow.scss')).toMatch(/--xy-controls-button-color:/);
        expect(read('src/index.scss')).toMatch(/^@use 'scss\/reactFlow';$/m);
    });
});
