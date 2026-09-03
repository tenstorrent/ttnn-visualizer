// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { detectLayerBlocks } from '../src/components/operation-graph/opGraphLayerBlocks';
import type { OpGraphSourceOperation } from '../src/components/operation-graph/opGraphTypes';
import bgeM3 from './fixtures/opRoles/bge_m3.json';
import moe from './fixtures/opRoles/moe.json';

// The adapter only needs `id` and `name`; the rest of the source shape is inert here.
const asSource = (operations: readonly { id: number; name: string }[]) =>
    operations as unknown as OpGraphSourceOperation[];

const operation = (id: number, name: string): OpGraphSourceOperation =>
    ({ id, name }) as unknown as OpGraphSourceOperation;

describe('detectLayerBlocks', () => {
    const blocks = detectLayerBlocks(asSource(bgeM3.operations));

    it('presents each role group as a foldable instance', () => {
        // 24 attention + 24 feed-forward + 1 embedding, the same partition the role
        // detector reports — the adapter must not lose or merge any of them.
        expect(blocks).toHaveLength(49);
    });

    it('numbers instances within their role and carries the role total', () => {
        const attention = blocks.filter((block) => block.patternLabel === 'Attention');

        expect(attention).toHaveLength(24);
        // Zero-based, matching `RepeatBlockInstance`: the panel renders
        // `instanceIndex + 1`, so a one-based index here read as "instance 2 of 1".
        expect(attention.map((block) => block.instanceIndex)).toEqual(Array.from({ length: 24 }, (_, index) => index));
        expect(new Set(attention.map((block) => block.instanceCount))).toEqual(new Set([24]));
        expect(attention[0].label).toBe('Attention 1');
        expect(attention[23].label).toBe('Attention 24');
    });

    it('drops the number when a role occurs once', () => {
        // "Embedding 1 of 1" reads as though a second one is missing.
        const embedding = blocks.filter((block) => block.patternLabel === 'Embedding');

        expect(embedding).toHaveLength(1);
        expect(embedding[0].label).toBe('Embedding');
    });

    it('keys the instance on its first member, not its position', () => {
        // Detection shifting by one span would otherwise renumber every id and orphan
        // whatever fold state the user had.
        for (const block of blocks) {
            expect(block.instanceId).toBe(`layer:${block.patternId.replace('layer:', '')}:${block.operationIds[0]}`);
        }
        expect(new Set(blocks.map((block) => block.instanceId)).size).toBe(blocks.length);
    });

    it('shares a pattern id across instances of one role', () => {
        const patterns = new Set(blocks.map((block) => block.patternId));

        expect(patterns).toEqual(new Set(['layer:attention', 'layer:feedForward', 'layer:embedding']));
    });

    it('refuses to fold a single operation', () => {
        // Folding one op replaces a node with a node: a click that costs and buys
        // nothing. A leading norm closes an empty span, so the embedding trails alone.
        const single = detectLayerBlocks([operation(1, 'ttnn.layer_norm'), operation(2, 'ttnn.embedding')]);
        const pair = detectLayerBlocks([
            operation(1, 'ttnn.layer_norm'),
            operation(2, 'ttnn.embedding'),
            operation(3, 'ttnn.linear'),
        ]);

        expect(single).toHaveLength(0);
        expect(pair).toHaveLength(1);
        expect(pair[0].operationIds).toEqual([2, 3]);
    });

    it('offers nothing for a report whose only span is the whole graph', () => {
        // The routing ops are recognised, but this capture has one `add` and no
        // normalisation, so the single span covers everything and is rejected on size
        // rather than folded into one box. #1976
        expect(detectLayerBlocks(asSource(moe.operations))).toHaveLength(0);
    });

    it('reports nothing for a graph of pure plumbing', () => {
        expect(
            detectLayerBlocks([
                operation(1, 'ttnn.from_torch'),
                operation(2, 'ttnn.to_device'),
                operation(3, 'ttnn.add'),
            ]),
        ).toHaveLength(0);
    });
});
