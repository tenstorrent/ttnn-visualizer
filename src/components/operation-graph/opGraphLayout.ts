// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import dagre from '@dagrejs/dagre';

const CHAR_WIDTH = 7.25;
const NODE_PADDING_X = 32;
const NODE_MIN_WIDTH = 108;
const NODE_MAX_WIDTH = 560;
const NODE_HEIGHT = 40;
const NODE_HEIGHT_WITH_FILE = 56;
// Wide enough for an edge to carry its shape label between two ranks without
// colliding with the neighbouring column.
const NODE_SEP = 30;
const RANK_SEP = 80;

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
    const longestLine = Math.max(label.length, fileIdentifier.length);
    const width = Math.ceil(
        Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, longestLine * CHAR_WIDTH + NODE_PADDING_X)),
    );
    return { width, height: fileIdentifier ? NODE_HEIGHT_WITH_FILE : NODE_HEIGHT };
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
