// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import relabelMlirGraphIds, { TEMP_UPLOAD_GRAPH_ID_MARKER } from '../src/functions/relabelMlirGraphIds';
import type { GraphBundle } from '../src/model/MLIRJsonModel';

describe('relabelMlirGraphIds', () => {
    it('replaces a single temp upload graph id with the upload stem', () => {
        const bundle = {
            graphs: [{ id: `${TEMP_UPLOAD_GRAPH_ID_MARKER}9_abcdef.mlir`, nodes: [] }],
        } as unknown as GraphBundle;

        expect(relabelMlirGraphIds(bundle, 'stablehlo_sdy').graphs[0].id).toBe('stablehlo_sdy');
    });

    it('preserves meaningful single-graph ids', () => {
        const bundle = {
            graphs: [{ id: 'stablehlo_sdy', nodes: [] }],
        } as unknown as GraphBundle;

        expect(relabelMlirGraphIds(bundle, 'upload_stem')).toBe(bundle);
    });

    it('rewrites only ttnn_viz_upload ids and leaves other /tmp paths alone', () => {
        const bundle = {
            graphs: [
                { id: `/tmp/${TEMP_UPLOAD_GRAPH_ID_MARKER}1.mlir`, nodes: [] },
                { id: 'microsoft_phi-2_stablehlo', nodes: [] },
                { id: '/tmp/other_tool/stablehlo_sdy.mlir', nodes: [] },
            ],
        } as unknown as GraphBundle;

        expect(relabelMlirGraphIds(bundle, 'uploaded_file').graphs.map((g) => g.id)).toEqual([
            'uploaded_file',
            'microsoft_phi-2_stablehlo',
            '/tmp/other_tool/stablehlo_sdy.mlir',
        ]);
    });

    it('rewrites multiple temp ids with stem suffixes', () => {
        const bundle = {
            graphs: [
                { id: `/tmp/${TEMP_UPLOAD_GRAPH_ID_MARKER}a.mlir`, nodes: [] },
                { id: `/tmp/${TEMP_UPLOAD_GRAPH_ID_MARKER}b.mlir`, nodes: [] },
                { id: `/tmp/${TEMP_UPLOAD_GRAPH_ID_MARKER}c.mlir`, nodes: [] },
            ],
        } as unknown as GraphBundle;

        expect(relabelMlirGraphIds(bundle, 'stem').graphs.map((g) => g.id)).toEqual(['stem', 'stem (2)', 'stem (3)']);
    });
});
