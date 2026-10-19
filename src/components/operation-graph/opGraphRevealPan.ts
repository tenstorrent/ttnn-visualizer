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
/** The column on the pane's right holding the slowest-operations list and the details. */
export const SIDE_CLASS = 'op-graph-side';
// Down the pane while the details sit below the list; the list alone takes only the height it needs. #2087
export const SIDE_WITH_DETAILS_CLASS = 'op-graph-side-with-details';
// Keeps a revealed node off the edge of the usable pane, where it reads as clipped.
// `topInset` and the side inset extend that for chrome that floats over the pane rather
// than shrinking it, so a target never lands behind the toolbar or the side column. #2007
const REVEAL_MARGIN_PX = 48;

/** A box in graph space. */
export interface GraphBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** The side column, as far in from the pane's right edge and down from its top as it reaches. */
export interface PaneSideInset {
    width: number;
    bottom: number;
}

export const NO_SIDE_INSET: Readonly<PaneSideInset> = Object.freeze({ width: 0, bottom: 0 });

/** The column's width if the vertical move leaves the target's top in the band the column covers, else 0. */
const sideInsetFor = (targetTop: number, side: Readonly<PaneSideInset>): number =>
    targetTop >= side.bottom ? 0 : side.width;

/** Graph-space `bounds` as the box they cover on the pane at `viewport`. */
const toPaneBox = (
    bounds: GraphBounds,
    viewport: { x: number; y: number; zoom: number },
): { left: number; top: number; right: number; bottom: number } => ({
    left: bounds.minX * viewport.zoom + viewport.x,
    top: bounds.minY * viewport.zoom + viewport.y,
    right: bounds.maxX * viewport.zoom + viewport.x,
    bottom: bounds.maxY * viewport.zoom + viewport.y,
});

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
    bounds: GraphBounds,
    viewport: { x: number; y: number; zoom: number },
    pane: { width: number; height: number },
    topInset = 0,
    side: Readonly<PaneSideInset> = NO_SIDE_INSET,
): { dx: number; dy: number } => {
    const { left, top, right, bottom } = toPaneBox(bounds, viewport);

    const axis = (nearEdge: number, farEdge: number, extent: number, nearInset: number, farInset: number): number => {
        const lowLimit = nearInset + REVEAL_MARGIN_PX;
        const highLimit = extent - farInset - REVEAL_MARGIN_PX;
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

    const dy = axis(top, bottom, pane.height, topInset, 0);
    // The column covers only the band it reaches down to, so a target the vertical
    // pan leaves below it may use the pane's full width. #2087
    return { dx: axis(left, right, pane.width, 0, sideInsetFor(top + dy, side)), dy };
};

/**
 * The pan that puts `bounds` in the middle of the usable pane.
 *
 * Distinct from `revealPanShift` because the gestures are: a reveal is the view
 * moving on its own and stays minimal, so it does nothing when the target
 * already fits. Recenter is the user asking, and answering "it was already
 * roughly visible, so nothing happened" makes the button look broken — which is
 * what it did. Still pans only; the zoom stays the user's. #2007
 */
export const centerPanShift = (
    bounds: GraphBounds,
    viewport: { x: number; y: number; zoom: number },
    pane: { width: number; height: number },
    topInset = 0,
    side: Readonly<PaneSideInset> = NO_SIDE_INSET,
): { dx: number; dy: number } => {
    const box = toPaneBox(bounds, viewport);
    // Centred in the band the toolbar leaves, not the raw pane, so a recentred
    // node sits where the eye is rather than tucked under the controls.
    const dy = topInset + (pane.height - topInset) / 2 - (box.top + box.bottom) / 2;
    const rightInset = sideInsetFor(box.top + dy, side);

    return { dx: (pane.width - rightInset) / 2 - (box.left + box.right) / 2, dy };
};

interface PannableNode {
    id?: string;
    position: { x: number; y: number };
    parentId?: string;
    width?: number | null;
    height?: number | null;
    measured?: { width?: number | null; height?: number | null };
}

/**
 * Where each node sits in flow coordinates, following `parentId`.
 *
 * React Flow positions a child relative to its parent, so a node inside a container
 * — a device operation, or a weight fan's member — carries an offset from the
 * container rather than from the pane. Every pan below works in flow coordinates, so
 * reading `position` directly sends the viewport to the top-left of the graph plus a
 * few pixels. Resolved once over the whole array rather than per call site, because
 * the callers that need it are reading a freshly built array the React Flow store has
 * not seen yet and so cannot answer for. #2028
 */
export const absolutePositionsOf = (nodes: readonly PannableNode[]): Map<string, { x: number; y: number }> => {
    const byId = new Map<string, PannableNode>();
    for (const node of nodes) {
        if (node.id !== undefined) {
            byId.set(node.id, node);
        }
    }

    const resolved = new Map<string, { x: number; y: number }>();
    // A parent chain is a tree in every graph this builds, but a cycle here would
    // hang the pane rather than misplace a node, so it is worth the one set.
    const inProgress = new Set<string>();

    const resolve = (node: PannableNode): { x: number; y: number } => {
        const { id } = node;
        if (id === undefined) {
            return node.position;
        }
        const seen = resolved.get(id);
        if (seen !== undefined) {
            return seen;
        }
        const parent = node.parentId === undefined || inProgress.has(id) ? undefined : byId.get(node.parentId);
        inProgress.add(id);
        const origin = parent === undefined ? { x: 0, y: 0 } : resolve(parent);
        inProgress.delete(id);

        const absolute = { x: origin.x + node.position.x, y: origin.y + node.position.y };
        resolved.set(id, absolute);
        return absolute;
    };

    for (const node of nodes) {
        resolve(node);
    }
    return resolved;
};

/**
 * The rectangle enclosing `nodes`, or null when there are none. Reads `measured` as
 * a fallback because React Flow fills `width`/`height` only after it has laid out.
 *
 * `positions` overrides each node's own `position`, which a caller passes when the
 * set may contain container children — see `absolutePositionsOf`.
 */
export const boundsOfNodes = (
    nodes: readonly PannableNode[],
    positions?: ReadonlyMap<string, { x: number; y: number }>,
): GraphBounds | null => {
    if (nodes.length === 0) {
        return null;
    }
    return nodes.reduce(
        (bounds, node) => {
            const at = (node.id === undefined ? undefined : positions?.get(node.id)) ?? node.position;
            return {
                minX: Math.min(bounds.minX, at.x),
                minY: Math.min(bounds.minY, at.y),
                maxX: Math.max(bounds.maxX, at.x + (node.width ?? node.measured?.width ?? 0)),
                maxY: Math.max(bounds.maxY, at.y + (node.height ?? node.measured?.height ?? 0)),
            };
        },
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
    graph: GraphBounds,
    start: GraphBounds,
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

/**
 * Whether any part of `bounds` is on screen at all.
 *
 * Deliberately not "is it comfortably visible": the only thing this decides is
 * whether the alternative to moving is an empty pane.
 */
export const intersectsPane = (
    bounds: GraphBounds,
    viewport: { x: number; y: number; zoom: number },
    pane: { width: number; height: number },
): boolean => {
    const box = toPaneBox(bounds, viewport);
    return box.right > 0 && box.left < pane.width && box.bottom > 0 && box.top < pane.height;
};
