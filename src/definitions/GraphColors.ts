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
// vis-network canvas. Colour-only encoding for now: vis-network's `size`
// option is ignored for the `'box'` shape used by op nodes (boxes size
// to their label content), so a node-size dimension would need a shape
// change to take effect. Revisit alongside any future shape rework.
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
