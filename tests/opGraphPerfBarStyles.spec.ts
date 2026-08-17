// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Asserted against the stylesheet text because jsdom does not compile SCSS, so
// a rendered node carries the class but none of its declarations. Same approach
// as `opGraphNodeStyles.spec.ts`.
const STYLESHEET = readFileSync(resolve(process.cwd(), 'src/scss/components/OperationGraphReactFlow.scss'), {
    encoding: 'utf8',
});

const COMPONENT = readFileSync(resolve(process.cwd(), 'src/components/operation-graph/OperationGraphReactFlow.tsx'), {
    encoding: 'utf8',
});

const ruleBody = (selector: string): string => {
    const start = STYLESHEET.indexOf(selector);
    expect(start, `${selector} not found`).toBeGreaterThan(-1);
    const open = STYLESHEET.indexOf('{', start);
    return STYLESHEET.slice(open + 1, STYLESHEET.indexOf('}', open));
};

const PERF_BAR = '&::after';

describe('perf overlay bar geometry', () => {
    it('is taken out of the node flow so toggling the overlay cannot relayout the graph', () => {
        // The node is a flex column, so an in-flow pseudo-element would become a
        // flex item and grow the node. Dagre sized the layout against the node's
        // measured box, so a taller node would leave every edge pointing at the
        // wrong place until the next rebuild. #1880
        expect(ruleBody(PERF_BAR)).toMatch(/position:\s*absolute/);
    });

    it('draws inside the node rather than resizing it', () => {
        const body = ruleBody(PERF_BAR);

        expect(body).toMatch(/bottom:\s*0/);
        expect(body).toMatch(/height:\s*\d/);
        // Anchored to a declaration so prose in the comments can't satisfy it.
        expect(body).not.toMatch(/^\s*(margin|padding)[a-z-]*\s*:/m);
    });
});

describe('perf overlay bar encoding', () => {
    it('takes both its length and its colour from the score', () => {
        const body = ruleBody(PERF_BAR);

        expect(body).toMatch(/width:\s*calc\(var\(--op-graph-perf-scale/);
        expect(body).toMatch(/background-color:\s*var\(--op-graph-perf-color/);
    });

    it('stays invisible for an op with no perf row', () => {
        // The fallback is what separates "no perf data" from "fastest op": an
        // unmapped node sets neither property, so the bar paints nothing even
        // though the minimum width still applies.
        expect(ruleBody(PERF_BAR)).toMatch(/background-color:\s*var\(--op-graph-perf-color,\s*transparent\)/);
    });

    it('keeps the slowest op distinguishable from the fastest', () => {
        // A zero-length bar for the coolest op would read as missing data, so
        // the scale floor is a visible stub rather than nothing.
        expect(ruleBody(PERF_BAR)).toMatch(/min-width:\s*[1-9]/);
    });
});

describe('perf overlay style channels', () => {
    it('writes only custom properties, leaving fill and border to their owners', () => {
        // Node background encodes the input/output highlight and the border
        // encodes selection. Perf has to compose with both rather than displace
        // either, which is why it gets its own channel.
        const perfPass = COMPONENT.slice(
            COMPONENT.indexOf('const perfStyleByNodeId'),
            COMPONENT.indexOf('const styledNodes'),
        );

        expect(perfPass).toContain('PERF_BAR_SCALE_VAR');
        expect(perfPass).toContain('PERF_BAR_COLOR_VAR');
        expect(perfPass).not.toMatch(/backgroundColor|borderColor|boxShadow|className/);
    });
});
