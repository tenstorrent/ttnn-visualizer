// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { GraphBundle, GraphDocument } from '../model/MLIRJsonModel';

// Must stay aligned with backend `mlir._TEMP_UPLOAD_BASENAME_PREFIX` (SCP path).
export const TEMP_UPLOAD_GRAPH_ID_MARKER = 'ttnn_viz_upload_';

// Only our SCP basename — not every `/tmp/…` path. Model Explorer often keeps
// meaningful report names under other temp locations; rewriting those drops
// valid entries from the split-pane select.
const isTempUploadGraphId = (id: string): boolean => id.includes(TEMP_UPLOAD_GRAPH_ID_MARKER);

// Model Explorer often sets graph.id from the remote temp upload path
// (`ttnn_viz_upload_<pid>_<uuid>.mlir`). Prefer the uploaded file stem for
// selects, keys, and headers. Canonical rewrite for server uploads lives in
// the backend (`relabel_graph_ids`); this helper is for local JSON ingest only.
const relabelMlirGraphIds = (bundle: GraphBundle, displayName: string): GraphBundle => {
    if (!displayName || bundle.graphs.length === 0) {
        return bundle;
    }

    if (bundle.graphs.length === 1) {
        const [graph] = bundle.graphs;
        if (!isTempUploadGraphId(graph.id) || graph.id === displayName) {
            return bundle;
        }
        return { graphs: [{ ...graph, id: displayName }] };
    }

    let changed = false;
    const graphs: GraphDocument[] = bundle.graphs.map((graph, index) => {
        if (!isTempUploadGraphId(graph.id)) {
            return graph;
        }
        changed = true;
        return {
            ...graph,
            id: index === 0 ? displayName : `${displayName} (${index + 1})`,
        };
    });

    return changed ? { graphs } : bundle;
};

export default relabelMlirGraphIds;
