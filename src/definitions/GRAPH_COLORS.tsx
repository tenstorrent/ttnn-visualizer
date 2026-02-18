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
};
