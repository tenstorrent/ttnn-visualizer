// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import { revealPanShift } from '../src/components/operation-graph/opGraphRevealPan';

const PANE = { width: 1000, height: 700 };
const AT_ORIGIN = { x: 0, y: 0, zoom: 1 };
// Matches REVEAL_MARGIN_PX; asserted against rather than imported so a change to
// the constant has to be a deliberate change to these expectations too.
const MARGIN = 48;

describe('revealPanShift', () => {
    it('does not move a set already comfortably in view', () => {
        const shift = revealPanShift({ minX: 200, minY: 200, maxX: 400, maxY: 400 }, AT_ORIGIN, PANE);

        expect(shift).toEqual({ dx: 0, dy: 0 });
    });

    it('pans down by the minimum when the set starts above the pane', () => {
        // Expanding upward is the case a top-edge anchor misses.
        const shift = revealPanShift({ minX: 200, minY: -120, maxX: 400, maxY: 100 }, AT_ORIGIN, PANE);

        expect(shift.dy).toBe(MARGIN + 120);
        expect(shift.dx).toBe(0);
    });

    it('pans up by the minimum when the set runs off the bottom', () => {
        // The reported case: a block low in the pane unrolls into 28 operations.
        const shift = revealPanShift({ minX: 100, minY: 500, maxX: 300, maxY: 900 }, AT_ORIGIN, PANE);

        expect(shift.dy).toBe(PANE.height - MARGIN - 900);
        expect(shift.dy).toBeLessThan(0);
    });

    it('aligns the near edge when the set is taller than the pane', () => {
        // Nothing can bring it all in, so it keeps the end the expansion started
        // from rather than scrolling past it.
        const shift = revealPanShift({ minX: 100, minY: 300, maxX: 300, maxY: 2000 }, AT_ORIGIN, PANE);

        expect(shift.dy).toBe(MARGIN - 300);
        // The top edge lands on the margin, not off-screen.
        expect(300 + shift.dy).toBe(MARGIN);
    });

    it('moves both axes when the set is off two edges at once', () => {
        const shift = revealPanShift({ minX: -200, minY: -50, maxX: 100, maxY: 200 }, AT_ORIGIN, PANE);

        expect(shift.dx).toBeGreaterThan(0);
        expect(shift.dy).toBeGreaterThan(0);
    });

    it('accounts for the live zoom and pan rather than raw graph coordinates', () => {
        // Same bounds, but already scrolled into view by the viewport: no pan.
        const bounds = { minX: 1000, minY: 1000, maxX: 1100, maxY: 1100 };
        const scrolled = { x: -900, y: -900, zoom: 1 };

        expect(revealPanShift(bounds, scrolled, PANE)).toEqual({ dx: 0, dy: 0 });
        // Unscrolled, the same bounds are far off the bottom-right.
        const unscrolled = revealPanShift(bounds, AT_ORIGIN, PANE);
        expect(unscrolled.dx).toBeLessThan(0);
        expect(unscrolled.dy).toBeLessThan(0);
    });

    it('scales the offsets by zoom, so a zoomed-out graph pans less', () => {
        const bounds = { minX: 200, minY: 1000, maxX: 400, maxY: 1200 };
        const near = revealPanShift(bounds, { x: 0, y: 0, zoom: 1 }, PANE);
        const far = revealPanShift(bounds, { x: 0, y: 0, zoom: 0.25 }, PANE);

        expect(Math.abs(far.dy)).toBeLessThan(Math.abs(near.dy));
    });
});
