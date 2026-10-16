// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PERF_BAR_COLOR_VAR, PERF_BAR_SCALE_VAR } from '../src/components/operation-graph/opGraphPerfOverlay';
import { NODE_ZOOM_VAR } from '../src/components/operation-graph/opGraphNodeZoom';

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

// Built from the exported names rather than re-typed. This is the seam the spec
// exists to protect: with literals, renaming a constant stops the bar painting
// while every assertion below still matches the SCSS the TS no longer writes.
const varRef = (name: string, fallback?: string) =>
    `var\\(${name}${fallback === undefined ? '' : `,\\s*${fallback}`}\\)`;

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

describe('slowest-operations rank badge', () => {
    const BADGE = '.op-graph-node-hot-rank {';

    it('is taken out of the node flow, so marking cannot relayout the graph', () => {
        expect(ruleBody(BADGE)).toMatch(/position:\s*absolute/);
    });

    it('sits above the box, so it covers neither the label nor the filter badge in its corner', () => {
        expect(ruleBody(BADGE)).toMatch(/transform:\s*translate\([^,]+,\s*-100%\)/);
    });

    it('takes the pointer, so a click on it selects its node rather than the pane behind', () => {
        expect(ruleBody(BADGE)).not.toMatch(/pointer-events:\s*none/);
    });

    it('stops growing before it can outgrow the gap to the row above', () => {
        // The layout keeps ranks 80 graph px apart, and the tab is ~1.7 font sizes tall.
        expect(ruleBody(BADGE)).toMatch(/font-size:\s*clamp\(\s*11px,.*,\s*40px\s*\)/);
    });

    it('divides its size by the live zoom, unscaled when none is published', () => {
        // Marking publishes the zoom too, so the badges still read at overview zoom. #2085
        expect(ruleBody(BADGE)).toMatch(
            new RegExp(`font-size:.*calc\\(\\s*\\d+px\\s*/\\s*${varRef(NODE_ZOOM_VAR, '1')}\\s*\\)`),
        );
    });
});

describe('perf overlay bar zoom floor', () => {
    it('divides both dimensions by the live zoom so the bar holds its on-screen size', () => {
        // Fixed graph units go sub-pixel at the zoom a large report fits in,
        // losing the encoding exactly where a whole-graph scan needs it. #1610
        const body = ruleBody(PERF_BAR);

        expect(body).toMatch(new RegExp(`height:.*calc\\(\\s*\\d+px\\s*/\\s*${varRef(NODE_ZOOM_VAR, '1')}\\s*\\)`));
        expect(body).toMatch(new RegExp(`min-width:.*calc\\(\\s*\\d+px\\s*/\\s*${varRef(NODE_ZOOM_VAR, '1')}\\s*\\)`));
    });

    it('falls back to an unscaled bar when the zoom is not published', () => {
        // The property is only written while the overlay is active, so the
        // fallback is the resting state: 1:1 size, not a collapse to zero.
        const body = ruleBody(PERF_BAR);

        expect(body).not.toMatch(new RegExp(varRef(NODE_ZOOM_VAR)));
        expect(body).toMatch(new RegExp(varRef(NODE_ZOOM_VAR, '1')));
    });
});

describe('perf overlay bar encoding', () => {
    it('takes both its length and its colour from the score', () => {
        const body = ruleBody(PERF_BAR);

        expect(body).toMatch(new RegExp(`width:\\s*calc\\(var\\(${PERF_BAR_SCALE_VAR}`));
        expect(body).toMatch(new RegExp(`background-color:\\s*var\\(${PERF_BAR_COLOR_VAR}`));
    });

    it('stays invisible for an op with no perf row', () => {
        // What separates "no perf data" from "fastest op": an unmapped node sets
        // neither property, so nothing paints even though min-width applies.
        expect(ruleBody(PERF_BAR)).toMatch(
            new RegExp(`background-color:\\s*${varRef(PERF_BAR_COLOR_VAR, 'transparent')}`),
        );
    });

    it('keeps the slowest op distinguishable from the fastest', () => {
        // A zero-length bar for the coolest op would read as missing data.
        expect(ruleBody(PERF_BAR)).toMatch(/min-width:\s*max\(\s*[1-9]/);
    });
});

describe('perf overlay bar containing block', () => {
    // The rule is shared with the expanded operation's group node, so the selector
    // is a list and `.react-flow__node-opNode` is matched with its trailing comma.
    const OP_NODE_RULE = '.react-flow__node-opNode,';

    it('anchors the bar to the node it annotates', () => {
        // Every geometry assertion above is relative to this. Declared rather than
        // inherited from `@xyflow/react`'s `.react-flow__node`, which this rule
        // outranks, so a vendor change cannot take the containing block away and
        // anchor every bar to the canvas — which *is* relative — instead.
        expect(ruleBody(OP_NODE_RULE)).toMatch(/position:\s*absolute/);
    });

    it('does not take the node out of the layout React Flow put it in', () => {
        // `relative` also establishes the containing block, so the bar renders and
        // every assertion above still passes — but the node rejoins document flow
        // while the edge SVG keeps drawing at the store's coordinates, and every
        // arrow detaches from its node. Only reproducible with layout, which jsdom
        // has none of, so it is pinned as a declaration. #1880
        expect(ruleBody(OP_NODE_RULE)).not.toMatch(/position:\s*(relative|static)/);
    });
});
