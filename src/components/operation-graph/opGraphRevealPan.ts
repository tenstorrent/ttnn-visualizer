// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Marks the nodes a structural toggle just produced, so an expand or fold is
// visibly *something appearing* rather than the graph rearranging itself.
//
// Held rather than timed out: the ring pulses for attention and then rests faint,
// and the faint state answers "which ones did I just open", which stays useful for
// as long as they are open. The next toggle replaces the set, so exactly one group
// is ever marked. #1944
export const REVEALED_NODE_CLASS = 'op-graph-node-revealed';
// Keeps a revealed node off the very edge of the pane, where it reads as clipped.
const REVEAL_MARGIN_PX = 48;

/**
 * The smallest pan that brings `bounds` inside the pane, or no pan when it
 * already fits.
 *
 * Minimal on purpose: `fitView` would answer "is it in view" while destroying
 * "did I lose my place", which is the same complaint. When the revealed set is
 * taller than the pane its top edge wins — that is where the expansion started
 * and where the user was looking.
 */
export const revealPanShift = (
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    viewport: { x: number; y: number; zoom: number },
    pane: { width: number; height: number },
): { dx: number; dy: number } => {
    const left = bounds.minX * viewport.zoom + viewport.x;
    const top = bounds.minY * viewport.zoom + viewport.y;
    const right = bounds.maxX * viewport.zoom + viewport.x;
    const bottom = bounds.maxY * viewport.zoom + viewport.y;

    const axis = (nearEdge: number, farEdge: number, extent: number): number => {
        const lowLimit = REVEAL_MARGIN_PX;
        const highLimit = extent - REVEAL_MARGIN_PX;
        if (farEdge - nearEdge > highLimit - lowLimit) {
            // Too large to fit: align the near edge and let the rest run off.
            return lowLimit - nearEdge;
        }
        if (nearEdge < lowLimit) {
            return lowLimit - nearEdge;
        }
        if (farEdge > highLimit) {
            return highLimit - farEdge;
        }
        return 0;
    };

    return { dx: axis(left, right, pane.width), dy: axis(top, bottom, pane.height) };
};
