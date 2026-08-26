// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import dagre from '@dagrejs/dagre';

const CHAR_WIDTH = 6.8;
const FILE_CHAR_WIDTH = 6.2;
const NODE_PADDING_X = 28;
const NODE_MIN_WIDTH = 108;
const NODE_MAX_WIDTH = 560;
const NODE_HEIGHT = 32;
const NODE_HEIGHT_WITH_FILE = 46;
const BLOCK_NODE_HEIGHT = 58;
// The device-operation badge, kept in step with `.op-graph-node-expander`.
const EXPANDER_WIDTH = 32;
// Pill chip (`▾ 336`) is wider than the device-op badge.
const BLOCK_EXPANDER_WIDTH = 52;
// Wide enough for an edge to carry its shape label between two ranks without
// colliding with the neighbouring column.
const NODE_SEP = 30;
const RANK_SEP = 80;

// The header carries the operation's own label and file, so it is sized like a
// collapsed node; the rest is breathing room around the nested subgraph.
const GROUP_HEADER_HEIGHT = NODE_HEIGHT_WITH_FILE;
const GROUP_PADDING_X = 12;
const GROUP_PADDING_TOP = GROUP_HEADER_HEIGHT + 8;
const GROUP_PADDING_BOTTOM = 12;

export interface LayoutInputNode {
    id: string;
    width: number;
    height: number;
}

export interface LayoutInputEdge {
    source: string;
    target: string;
}

export interface LayoutPosition {
    x: number;
    y: number;
}

/**
 * `hasExpander` widens the box by the badge rather than letting it overhang the
 * corner: the badge is absolutely positioned so it can't grow the node itself,
 * and without the reservation it either clips at the boundary or lands on the
 * label of a node sized to that label alone. #1195
 */
export function estimateOpNodeSize(
    label: string,
    fileIdentifier: string,
    hasExpander = false,
): { width: number; height: number } {
    const widestLine = Math.max(label.length * CHAR_WIDTH, fileIdentifier.length * FILE_CHAR_WIDTH);
    // Clamp the label first: folding `EXPANDER_WIDTH` into `contentWidth` before
    // `NODE_MAX_WIDTH` discarded the badge reservation on any node already at the
    // cap, which is the overlap the parameter exists to prevent.
    const labelWidth = Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, widestLine + NODE_PADDING_X));
    const width = Math.ceil(labelWidth + (hasExpander ? EXPANDER_WIDTH : 0));
    return { width, height: fileIdentifier ? NODE_HEIGHT_WITH_FILE : NODE_HEIGHT };
}

export function estimateBlockNodeSize(label: string, meta: string): { width: number; height: number } {
    const widestLine = Math.max(label.length * CHAR_WIDTH, meta.length * FILE_CHAR_WIDTH);
    const labelWidth = Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, widestLine + NODE_PADDING_X));
    return { width: Math.ceil(labelWidth + BLOCK_EXPANDER_WIDTH), height: BLOCK_NODE_HEIGHT };
}

function runDagre(nodes: LayoutInputNode[], edges: LayoutInputEdge[], ranker: string): Map<string, LayoutPosition> {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({
        rankdir: 'TB',
        nodesep: NODE_SEP,
        ranksep: RANK_SEP,
        edgesep: 10,
        ranker,
        marginx: 20,
        marginy: 20,
    });
    graph.setDefaultEdgeLabel(() => ({}));

    const known = new Set<string>();
    for (const node of nodes) {
        graph.setNode(node.id, { width: node.width, height: node.height });
        known.add(node.id);
    }
    for (const edge of edges) {
        if (edge.source !== edge.target && known.has(edge.source) && known.has(edge.target)) {
            graph.setEdge(edge.source, edge.target);
        }
    }

    dagre.layout(graph);

    const positions = new Map<string, LayoutPosition>();
    for (const node of nodes) {
        const laidOut = graph.node(node.id);
        positions.set(node.id, { x: laidOut.x - node.width / 2, y: laidOut.y - node.height / 2 });
    }
    return positions;
}

export interface DeviceSubgraphLayout {
    /** Child offsets from the group's own origin, as React Flow reads them. */
    positions: Map<string, LayoutPosition>;
    width: number;
    height: number;
}

/**
 * Lays a device-operation subgraph out on its own, then reports the box it needs.
 * Inside-out is what makes nesting work without Dagre compound support: the
 * enclosing layout only ever sees one node of a known size, so it packs an
 * expanded operation exactly as it packs a collapsed one.
 *
 * `headerWidth` is the collapsed node's width — the group can be wider than its
 * contents but never narrower than its own label.
 */
export function layoutDeviceSubgraph(
    nodes: LayoutInputNode[],
    edges: LayoutInputEdge[],
    headerWidth: number,
): DeviceSubgraphLayout {
    const laidOut = layoutOpGraph(nodes, edges);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
        const position = laidOut.get(node.id);
        if (position !== undefined) {
            minX = Math.min(minX, position.x);
            minY = Math.min(minY, position.y);
            maxX = Math.max(maxX, position.x + node.width);
            maxY = Math.max(maxY, position.y + node.height);
        }
    }

    if (!Number.isFinite(minX)) {
        return { positions: new Map(), width: headerWidth, height: GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM };
    }

    const positions = new Map<string, LayoutPosition>();
    for (const node of nodes) {
        const position = laidOut.get(node.id);
        if (position !== undefined) {
            positions.set(node.id, {
                x: position.x - minX + GROUP_PADDING_X,
                y: position.y - minY + GROUP_PADDING_TOP,
            });
        }
    }

    return {
        positions,
        width: Math.max(headerWidth, Math.ceil(maxX - minX) + GROUP_PADDING_X * 2),
        height: Math.ceil(maxY - minY) + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM,
    };
}

// `network-simplex` is deliberately not the fallback: on a 4k-node graph it took
// 28s against `tight-tree`'s 786ms, and over 8 minutes at 8k. `longest-path` is
// O(V+E) so it cannot degenerate, at the cost of taller layouts. #1809
export function layoutOpGraph(nodes: LayoutInputNode[], edges: LayoutInputEdge[]): Map<string, LayoutPosition> {
    if (nodes.length === 0) {
        return new Map();
    }
    try {
        return runDagre(nodes, edges, 'tight-tree');
    } catch {
        return runDagre(nodes, edges, 'longest-path');
    }
}
