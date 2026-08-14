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
// Normal is wide enough for an edge to carry its shape label between two ranks
// without colliding with the neighbouring column. Compact trades that room for
// fitting more of the graph on screen, which is the point of the toggle.
const SPACING = {
    normal: { nodesep: 30, ranksep: 80 },
    compact: { nodesep: 16, ranksep: 48 },
} as const;

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

export function estimateOpNodeSize(label: string, fileIdentifier: string): { width: number; height: number } {
    const widestLine = Math.max(label.length * CHAR_WIDTH, fileIdentifier.length * FILE_CHAR_WIDTH);
    const width = Math.ceil(Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, widestLine + NODE_PADDING_X)));
    return { width, height: fileIdentifier ? NODE_HEIGHT_WITH_FILE : NODE_HEIGHT };
}

function runDagre(
    nodes: LayoutInputNode[],
    edges: LayoutInputEdge[],
    ranker: string,
    isCompact: boolean,
): Map<string, LayoutPosition> {
    const spacing = isCompact ? SPACING.compact : SPACING.normal;
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({
        rankdir: 'TB',
        nodesep: spacing.nodesep,
        ranksep: spacing.ranksep,
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

// `network-simplex` is deliberately not the fallback: on a 4k-node graph it took
// 28s against `tight-tree`'s 786ms, and over 8 minutes at 8k. `longest-path` is
// O(V+E) so it cannot degenerate, at the cost of taller layouts. #1809
export function layoutOpGraph(
    nodes: LayoutInputNode[],
    edges: LayoutInputEdge[],
    isCompact = false,
): Map<string, LayoutPosition> {
    if (nodes.length === 0) {
        return new Map();
    }
    try {
        return runDagre(nodes, edges, 'tight-tree', isCompact);
    } catch {
        return runDagre(nodes, edges, 'longest-path', isCompact);
    }
}
