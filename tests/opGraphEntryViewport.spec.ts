// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import { boundsOfNodes, entryViewport } from '../src/components/operation-graph/opGraphRevealPan';

// Entry is the only moment the view picks a zoom for the user, so the arithmetic that
// picks it is worth pinning directly rather than through a rendered graph. #2007
const PANE = { width: 1000, height: 800 };
const MARGIN = 48;

const boundsOf = (minX: number, minY: number, width: number, height: number) => ({
    minX,
    minY,
    maxX: minX + width,
    maxY: minY + height,
});

describe('boundsOfNodes', () => {
    it('encloses every node', () => {
        const bounds = boundsOfNodes([
            { position: { x: 10, y: 20 }, width: 100, height: 40 },
            { position: { x: 300, y: 5 }, width: 50, height: 10 },
        ]);

        expect(bounds).toEqual({ minX: 10, minY: 5, maxX: 350, maxY: 60 });
    });

    it('falls back to the measured size React Flow fills in after layout', () => {
        // `width`/`height` are null until a node has been measured, and treating that
        // as zero shrinks the rectangle the viewport is framed against.
        const bounds = boundsOfNodes([{ position: { x: 0, y: 0 }, measured: { width: 120, height: 30 } }]);

        expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 120, maxY: 30 });
    });

    it('has no rectangle for no nodes', () => {
        expect(boundsOfNodes([])).toBeNull();
    });
});

describe('entryViewport', () => {
    it('never magnifies past 1:1, however small the graph', () => {
        // A ten-op report would otherwise open at 8x, with two nodes filling the pane.
        const graph = boundsOf(0, 0, 100, 80);

        expect(entryViewport(graph, graph, PANE).zoom).toBe(1);
    });

    it('never drops below overview zoom, however large the graph', () => {
        // An unclamped fit on a real 900-op graph is ~0.05, which is past reading.
        const graph = boundsOf(0, 0, 40000, 30000);

        expect(entryViewport(graph, boundsOf(0, 0, 200, 60), PANE).zoom).toBe(0.3);
    });

    it('fits a graph that lands between the two bounds', () => {
        const graph = boundsOf(0, 0, 1808, 704);

        const { zoom } = entryViewport(graph, graph, PANE);

        expect(zoom).toBeCloseTo(0.5, 5);
        expect(zoom * 1808).toBeLessThanOrEqual(PANE.width - 2 * MARGIN);
    });

    it('centres the whole graph horizontally when it fits', () => {
        const graph = boundsOf(0, 0, 1808, 704);

        const { x, zoom } = entryViewport(graph, graph, PANE);

        expect(x + (graph.minX + 1808 / 2) * zoom).toBeCloseTo(PANE.width / 2, 5);
    });

    it('anchors on the start rather than the graph corner when the graph does not fit', () => {
        // A wide layout's bounding-box corner is empty space: here the first node sits
        // 12000 to the right of whatever node sets `minX`, so framing the corner shows
        // nothing at all.
        const graph = boundsOf(0, 0, 40000, 30000);
        const start = boundsOf(12000, 400, 200, 60);

        const { x, y, zoom } = entryViewport(graph, start, PANE);

        expect(x + (start.minX + 100) * zoom).toBeCloseTo(PANE.width / 2, 5);
        expect(y + start.minY * zoom).toBeCloseTo(MARGIN, 5);
    });

    it('leaves the top inset clear, because the toolbar floats over the pane', () => {
        // Ignoring it put the opening nodes underneath the controls.
        const graph = boundsOf(0, 0, 40000, 30000);
        const start = boundsOf(0, 0, 200, 60);

        const { y } = entryViewport(graph, start, PANE, 157);

        expect(y).toBeCloseTo(157 + MARGIN, 5);
    });

    it('reserves the inset out of the height it fits against', () => {
        // Otherwise a graph that only fits by using the toolbar's band is scaled to
        // "fit" and then framed below it, running off the bottom.
        const graph = boundsOf(0, 0, 100, 700);

        const withoutChrome = entryViewport(graph, graph, PANE).zoom;
        const withChrome = entryViewport(graph, graph, PANE, 300).zoom;

        expect(withChrome).toBeLessThan(withoutChrome);
    });

    it('survives a degenerate pane without dividing by zero', () => {
        const graph = boundsOf(0, 0, 500, 500);

        const { zoom, x, y } = entryViewport(graph, graph, { width: 0, height: 0 });

        expect(Number.isFinite(zoom)).toBe(true);
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
    });
});
