// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Asserted against the stylesheet text because jsdom does not compile SCSS, so
// a rendered node carries the class but none of its declarations. Anchored on
// the cwd rather than `import.meta.url`, which jsdom serves over http.
const STYLESHEET = readFileSync(resolve(process.cwd(), 'src/scss/components/OperationGraphReactFlow.scss'), {
    encoding: 'utf8',
});

const ruleBody = (selector: string): string => {
    const start = STYLESHEET.indexOf(selector);
    expect(start, `${selector} not found`).toBeGreaterThan(-1);
    const open = STYLESHEET.indexOf('{', start);
    return STYLESHEET.slice(open + 1, STYLESHEET.indexOf('}', open));
};

describe('op graph selected node styling', () => {
    it('draws selection as a ring in the dedicated selection colour', () => {
        expect(ruleBody('&.op-graph-node-selected')).toMatch(/box-shadow:[^;]*--graph-selected/);
    });

    it('does not borrow a colour that already encodes a relation to the selection', () => {
        // `--graph-focused-node`, `--graph-output-node` and `--graph-output-edge`
        // are all the same hex, so a selection ring in any of them is
        // indistinguishable from the edges leaving the selected node and from
        // the consumer nodes those edges land on. #1809
        expect(ruleBody('&.op-graph-node-selected')).not.toMatch(/--graph-(focused-node|output-node|output-edge)/);
    });

    it('leaves the fill alone so the label keeps its contrast when selected', () => {
        // The selection colour against black body text is 4.25:1, under the 4.5:1
        // floor, and 2.53:1 for the grey file line. Painting it as a fill made a
        // selected node the least readable one on the canvas.
        expect(ruleBody('&.op-graph-node-selected')).not.toContain('background');
    });
});
