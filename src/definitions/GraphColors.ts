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
};

// Perf overlay bins (#1515). Hardcoded hex — these are tuned for the dark
// vis-network canvas. Top two bins grow node size so the hottest ops remain
// visible when the graph is zoomed out.
export interface PerfBin {
    color: string;
    size: number;
}

export const PERF_BIN_DEFAULT_SIZE = 20;

export const PERF_BINS: readonly PerfBin[] = [
    { color: '#3b4a6b', size: PERF_BIN_DEFAULT_SIZE },
    { color: '#3f7d8c', size: PERF_BIN_DEFAULT_SIZE },
    { color: '#f0c800', size: PERF_BIN_DEFAULT_SIZE },
    { color: '#f08a00', size: 26 },
    { color: '#ff3b1f', size: 32 },
] as const;
