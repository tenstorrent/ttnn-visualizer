// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cssVar } from '../functions/colour';

export const GRAPH_COLORS = {
    inputNode: cssVar(`--graph-input-node`),
    outputNode: cssVar(`--graph-output-node`),
    inputEdge: cssVar(`--graph-input-edge`),
    outputEdge: cssVar(`--graph-output-edge`),
    normal: cssVar(`--graph-normal`),
    focusedNode: cssVar(`--graph-focused-node`),
    // MLIR node identity colours, shared by the SCSS, the minimap callback and
    // the on-canvas legend so none of them drift.
    opNode: cssVar(`--graph-op-node`),
    group: cssVar(`--graph-group`),
    sectionGroup: cssVar(`--graph-section-group`),
    selected: cssVar(`--graph-selected`),
};

// Perf overlay bins (#1515). Hardcoded hex — tuned to read against the graph's
// node fills. Since #1880 the ramp is one of two dimensions: it colours an inset
// bar whose width carries the same score, so magnitude survives where colour
// alone was ambiguous.
export interface PerfBin {
    color: string;
}

export const PERF_BINS: readonly PerfBin[] = [
    { color: '#3b4a6b' },
    { color: '#3f7d8c' },
    { color: '#f0c800' },
    { color: '#f08a00' },
    { color: '#ff3b1f' },
] as const;
