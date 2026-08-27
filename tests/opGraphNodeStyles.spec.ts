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

describe('op graph filter dimming', () => {
    // The direction matters for more than tidiness: React Flow diffs elements by
    // object identity, so the side carrying the class is the side that gets a
    // fresh object on every render. Dimming has to be the container's job and the
    // exemption the matched set's, never the other way round.
    it('dims from the container rather than per non-matching element', () => {
        const body = ruleBody('&.op-graph-filtering');

        expect(body).toMatch(/\.react-flow__node/);
        expect(body).toMatch(/\.react-flow__edge/);
        expect(body).toMatch(/opacity:\s*0?\.\d+/);
    });

    it('exempts the matched set rather than listing the dimmed one', () => {
        const filtering = STYLESHEET.slice(STYLESHEET.indexOf('&.op-graph-filtering'));

        expect(filtering).toMatch(/\.op-graph-node-match[\s,][^}]*opacity:\s*1/s);
        expect(filtering).toMatch(/\.op-graph-edge-match[^}]*opacity:\s*1/s);
    });

    it('fades whole edge groups so a label cannot outlive its edge', () => {
        // The label is a sibling of the path inside the edge group, so an opacity
        // on `.react-flow__edge-path` would leave it bright over a faded edge —
        // which is what the removed inline `opacity` on the `<text>` was for.
        expect(ruleBody('&.op-graph-filtering')).not.toContain('__edge-path');
    });
});

describe('op graph critical path styling', () => {
    const OFF_PATH_DIM_SELECTOR = '&.op-graph-critical-path:not(.op-graph-filtering)';

    it('accents the path before the I/O rules so a focused node keeps its own colours', () => {
        // Both match at the same specificity, so the later rule wins. Order is the
        // only thing keeping the selected node's edges their input/output colour
        // while the rest of the path reads magenta. #1613
        const accent = STYLESHEET.indexOf('.op-graph-edge-critical-path .react-flow__edge-path');
        const inputEdge = STYLESHEET.indexOf('.op-graph-edge-input .react-flow__edge-path');
        const outputEdge = STYLESHEET.indexOf('.op-graph-edge-output .react-flow__edge-path');

        expect(accent).toBeGreaterThan(-1);
        expect(inputEdge).toBeGreaterThan(-1);
        expect(outputEdge).toBeGreaterThan(-1);
        expect(accent).toBeLessThan(inputEdge);
        // Both I/O rules, not just the first: a selected node's outgoing edges
        // have the same claim on their colour as its incoming ones.
        expect(accent).toBeLessThan(outputEdge);
    });

    it('yields the dimming to an active search', () => {
        // Without the `:not()` this rule's extra specificity would beat the
        // filter's 0.18 and quietly weaken search dimming whenever the path is on.
        expect(STYLESHEET).toContain(OFF_PATH_DIM_SELECTOR);
    });

    it('shares the off-path dim with dim-unrelated-edges', () => {
        expect(STYLESHEET).toContain('&.op-graph-focus-edges:not(.op-graph-filtering)');
        expect(ruleBody(OFF_PATH_DIM_SELECTOR)).toMatch(/opacity:\s*0\.35/);
    });

    it('exempts the selected node′s own edges from the off-path dim', () => {
        // Clicking a node to read its inputs and outputs would otherwise fade
        // whichever of them sit off the path. Read out of the `:not()` arguments
        // rather than matched as text: a selector list and chained `:not()`s exclude
        // the same set, so asserting one spelling pins the authoring style instead.
        const exclusions = Array.from(ruleBody(OFF_PATH_DIM_SELECTOR).matchAll(/:not\(([^)]*)\)/g))
            .flatMap(([, argument]) => argument.split(','))
            .map((selector) => selector.trim());

        // The path's own edges first: dropping this member dims the feature's
        // central visual along with everything it was meant to stand out from.
        expect(exclusions).toContain('.op-graph-edge-critical-path');
        expect(exclusions).toContain('.op-graph-edge-input');
        expect(exclusions).toContain('.op-graph-edge-output');
    });

    it('dims from the container rather than per off-path element', () => {
        // Same identity argument as the filter above: ~500 off-path edges must not
        // each carry a class.
        const body = ruleBody(OFF_PATH_DIM_SELECTOR);

        expect(body).toMatch(/\.react-flow__edge/);
        expect(body).toMatch(/opacity:\s*0?\.\d+/);
    });

    it('offsets the path outline clear of the selection ring', () => {
        // Outline paints over box-shadow, so an offset inside the ring's radius
        // replaces the selection colour with the path colour on a node that is
        // both. Asserted against the ring's own width so the two can't drift.
        const ringWidth = Number(
            /box-shadow:[^;]*?(\d+)px\s*(?:var|#|rgb)/.exec(ruleBody('&.op-graph-node-selected'))?.[1],
        );
        const outlineOffset = Number(
            /outline-offset:\s*(\d+)px/.exec(ruleBody('.react-flow__node-opNode.op-graph-node-critical-path'))?.[1],
        );

        expect(ringWidth).toBeGreaterThan(0);
        expect(outlineOffset).toBeGreaterThan(ringWidth);
    });
});
