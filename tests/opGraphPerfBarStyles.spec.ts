// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom doesn't compile SCSS, so a rendered node carries the class but none of
// its declarations. Same approach as `opGraphNodeStyles.spec.ts`.
const STYLESHEET = readFileSync(resolve(process.cwd(), 'src/scss/components/OperationGraphReactFlow.scss'), {
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
        // flex item and grow it past the box Dagre measured, leaving every edge
        // pointing at the wrong place until the next rebuild. #1880
        expect(ruleBody(PERF_BAR)).toMatch(/position:\s*absolute/);
    });

    it('draws inside the node rather than resizing it', () => {
        const body = ruleBody(PERF_BAR);

        expect(body).toMatch(/bottom:\s*0/);
        expect(body).toMatch(/height:\s*\S/);
        // Anchored to a declaration so prose in the comments can't satisfy it.
        expect(body).not.toMatch(/^\s*(margin|padding)[a-z-]*\s*:/m);
    });

    it('never grows past the node it annotates', () => {
        // The zoom divisor is unbounded as zoom approaches its 0.02 floor, so
        // without the ceiling the bar overflows onto its neighbours.
        expect(ruleBody(PERF_BAR)).toMatch(/height:\s*min\(\s*100%/);
    });
});

describe('perf overlay bar zoom floor', () => {
    it('divides both dimensions by the live zoom so the bar holds its on-screen size', () => {
        // Fixed graph units go sub-pixel at the zoom a large report fits in,
        // losing the encoding exactly where a whole-graph scan needs it. #1610
        const body = ruleBody(PERF_BAR);

        expect(body).toMatch(/height:.*calc\(\s*\d+px\s*\/\s*var\(--op-graph-perf-zoom,\s*1\)\s*\)/);
        expect(body).toMatch(/min-width:.*calc\(\s*\d+px\s*\/\s*var\(--op-graph-perf-zoom,\s*1\)\s*\)/);
    });

    it('falls back to an unscaled bar when the zoom is not published', () => {
        // The property is only written while the overlay is active, so the
        // fallback is the resting state: 1:1 size, not a collapse to zero.
        const body = ruleBody(PERF_BAR);

        expect(body).not.toMatch(/var\(--op-graph-perf-zoom\)/);
        expect(body).toMatch(/var\(--op-graph-perf-zoom,\s*1\)/);
    });
});

describe('perf overlay bar encoding', () => {
    it('takes both its length and its colour from the score', () => {
        const body = ruleBody(PERF_BAR);

        expect(body).toMatch(/width:\s*calc\(var\(--op-graph-perf-scale/);
        expect(body).toMatch(/background-color:\s*var\(--op-graph-perf-color/);
    });

    it('stays invisible for an op with no perf row', () => {
        // What separates "no perf data" from "fastest op": an unmapped node sets
        // neither property, so nothing paints even though min-width applies.
        expect(ruleBody(PERF_BAR)).toMatch(/background-color:\s*var\(--op-graph-perf-color,\s*transparent\)/);
    });

    it('keeps the slowest op distinguishable from the fastest', () => {
        // A zero-length bar for the coolest op would read as missing data.
        expect(ruleBody(PERF_BAR)).toMatch(/min-width:\s*max\(\s*[1-9]/);
    });
});
