// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    type LayoutInputEdge,
    type LayoutInputNode,
    estimateOpNodeSize,
    layoutOpGraph,
} from '../src/components/operation-graph/opGraphLayout';

// Long enough to clear the minimum-width clamp, so a width assertion reflects
// the measurement rather than the floor.
const LONG = 'x'.repeat(50);

const sized = (id: string, width: number, height: number): LayoutInputNode => ({ id, width, height });

describe('estimateOpNodeSize', () => {
    it('measures the file line with a narrower ratio than the label', () => {
        // Same string, so anything but a narrower file ratio makes these equal.
        // The file line renders two points smaller than the label.
        const asLabel = estimateOpNodeSize(LONG, '').width;
        const asFile = estimateOpNodeSize('', LONG).width;

        expect(asFile).toBeLessThan(asLabel);
    });

    it('sizes to the widest line in pixels, not the longest in characters', () => {
        // 45 label chars outmeasure 48 file chars at their respective ratios, so
        // a character-count comparison would widen the box for nothing.
        const label = 'x'.repeat(45);
        const longerFile = 'y'.repeat(48);

        expect(estimateOpNodeSize(label, longerFile).width).toBe(estimateOpNodeSize(label, '').width);
    });

    it('widens for a file line that does outmeasure the label', () => {
        expect(estimateOpNodeSize('op', LONG).width).toBeGreaterThan(estimateOpNodeSize('op', 'a.py:1').width);
    });

    it('clamps a short label up to the minimum width', () => {
        // Both are under the floor, so they meet there.
        expect(estimateOpNodeSize('a', '').width).toBe(estimateOpNodeSize('ab', '').width);
    });

    it('clamps a very long label down to the maximum width', () => {
        const wide = estimateOpNodeSize('x'.repeat(1000), '').width;

        expect(wide).toBe(estimateOpNodeSize('x'.repeat(2000), '').width);
        expect(wide).toBeLessThan(1000);
    });

    it('still reserves the expander after the label hits the maximum width', () => {
        const label = 'x'.repeat(400);
        expect(estimateOpNodeSize(label, '', true).width).toBeGreaterThan(estimateOpNodeSize(label, '', false).width);
    });

    it('returns an integer width, which dagre and React Flow both position on', () => {
        // 21 chars lands mid-pixel before the ceil.
        expect(Number.isInteger(estimateOpNodeSize('x'.repeat(21), '').width)).toBe(true);
    });

    it('reserves a second line only when there is a file identifier', () => {
        const withFile = estimateOpNodeSize('op', 'a.py:1').height;
        const withoutFile = estimateOpNodeSize('op', '').height;

        expect(withFile).toBeGreaterThan(withoutFile);
        // The renderer omits the element entirely for an empty string, so the
        // height has to follow the same falsy test rather than `!== undefined`.
        expect(estimateOpNodeSize('op', '').height).toBe(withoutFile);
    });

    it('keeps the height independent of how long either line is', () => {
        expect(estimateOpNodeSize(LONG, LONG).height).toBe(estimateOpNodeSize('op', 'a.py:1').height);
    });
});

describe('layoutOpGraph', () => {
    it('returns nothing for an empty graph rather than invoking dagre', () => {
        expect(layoutOpGraph([], [])).toEqual(new Map());
    });

    it('positions every node, including one with no edges', () => {
        const nodes = [sized('a', 100, 32), sized('b', 100, 32), sized('island', 100, 32)];

        const positions = layoutOpGraph(nodes, [{ source: 'a', target: 'b' }]);

        expect([...positions.keys()].sort()).toEqual(['a', 'b', 'island']);
        for (const { x, y } of positions.values()) {
            expect(Number.isFinite(x)).toBe(true);
            expect(Number.isFinite(y)).toBe(true);
        }
    });

    it('converts dagre centres to top-left corners', () => {
        // Same rank, different heights. Dagre centres both on one line, so equal
        // centres after adding half the height is only true of a converted
        // corner — returning the centre unchanged would make the raw `y`s equal
        // and these sums differ.
        const tall = sized('tall', 100, 90);
        const short = sized('short', 100, 30);

        const positions = layoutOpGraph([tall, short], []);

        const tallCentre = positions.get('tall')!.y + tall.height / 2;
        const shortCentre = positions.get('short')!.y + short.height / 2;
        expect(tallCentre).toBeCloseTo(shortCentre, 5);
        expect(positions.get('tall')!.y).not.toBeCloseTo(positions.get('short')!.y, 5);
    });

    it('ranks a target below its source', () => {
        const positions = layoutOpGraph(
            [sized('src', 100, 32), sized('dst', 100, 32)],
            [{ source: 'src', target: 'dst' }],
        );

        expect(positions.get('dst')!.y).toBeGreaterThan(positions.get('src')!.y);
    });

    it('ignores an edge naming a node that is not in the graph', () => {
        // Filtering nodes out of the list without pruning their edges is normal
        // here (the deallocate-op toggle does it), and dagre invents a node for
        // an unknown endpoint. The invented node takes a rank of its own, which
        // pushes everything downstream of it down a level, so the guard has to
        // be checked against the rank delta rather than mere presence.
        const nodes = [sized('a', 100, 32), sized('b', 100, 32)];
        const edges: LayoutInputEdge[] = [
            { source: 'a', target: 'b' },
            { source: 'a', target: 'ghost' },
            { source: 'ghost', target: 'b' },
        ];

        const withGhost = layoutOpGraph(nodes, edges);
        const control = layoutOpGraph(nodes, [{ source: 'a', target: 'b' }]);

        expect([...withGhost.keys()].sort()).toEqual(['a', 'b']);
        expect(withGhost.get('b')!.y - withGhost.get('a')!.y).toBeCloseTo(control.get('b')!.y - control.get('a')!.y, 5);
    });
});
