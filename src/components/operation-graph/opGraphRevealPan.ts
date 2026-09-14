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

interface PannableNode {
    position: { x: number; y: number };
    width?: number | null;
    height?: number | null;
    measured?: { width?: number | null; height?: number | null };
}

/**
 * The rectangle enclosing `nodes`, or null when there are none. Reads `measured` as
 * a fallback because React Flow fills `width`/`height` only after it has laid out.
 */
export const boundsOfNodes = (
    nodes: readonly PannableNode[],
): { minX: number; minY: number; maxX: number; maxY: number } | null => {
    if (nodes.length === 0) {
        return null;
    }
    return nodes.reduce(
        (bounds, node) => ({
            minX: Math.min(bounds.minX, node.position.x),
            minY: Math.min(bounds.minY, node.position.y),
            maxX: Math.max(bounds.maxX, node.position.x + (node.width ?? node.measured?.width ?? 0)),
            maxY: Math.max(bounds.maxY, node.position.y + (node.height ?? node.measured?.height ?? 0)),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
};

// Entry is the one moment the view may choose a zoom, so fit is clamped both ways:
// 1:1 shows four nodes of a real report, and an unclamped fit is ~0.05 on 900 ops.
// The floor is the 0.1-0.3 band the stylesheet already calls overview zoom. #2007
const ENTRY_MIN_ZOOM = 0.3;
const ENTRY_MAX_ZOOM = 1;

/**
 * Where the viewport starts: the whole graph when it fits, otherwise the start of
 * it at overview zoom, centred horizontally and clear of `topInset`.
 *
 * Anchors on `start` rather than the graph's bounding box whenever the graph is
 * larger than the pane — on a wide layout the box's corner is empty space, with
 * some node far down the y axis setting `minX`. `topInset` is the toolbar, which
 * floats over the pane rather than shrinking it, so framing that ignores it puts
 * the first nodes underneath the controls.
 */
export const entryViewport = (
    graph: { minX: number; minY: number; maxX: number; maxY: number },
    start: { minX: number; minY: number; maxX: number; maxY: number },
    pane: { width: number; height: number },
    topInset = 0,
): { x: number; y: number; zoom: number } => {
    const usableWidth = Math.max(pane.width - 2 * REVEAL_MARGIN_PX, 1);
    const usableHeight = Math.max(pane.height - topInset - 2 * REVEAL_MARGIN_PX, 1);
    const graphWidth = Math.max(graph.maxX - graph.minX, 1);
    const graphHeight = Math.max(graph.maxY - graph.minY, 1);

    const fit = Math.min(usableWidth / graphWidth, usableHeight / graphHeight);
    const zoom = Math.min(ENTRY_MAX_ZOOM, Math.max(ENTRY_MIN_ZOOM, fit));
    // `zoom <= fit` rather than re-deriving `graphWidth * zoom <= usableWidth`: the
    // re-derivation rounds the other way on ~1.6% of widths and off-centres a graph
    // that does fit.
    const fits = zoom <= fit;
    const anchor = fits ? graph : start;
    const anchorWidth = anchor.maxX - anchor.minX;

    return {
        zoom,
        x: pane.width / 2 - (anchor.minX + anchorWidth / 2) * zoom,
        y: topInset + REVEAL_MARGIN_PX - anchor.minY * zoom,
    };
};
