// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    OpRoleConfidence,
    type OpRoleGroup,
    type OpRoleSourceOperation,
    OpSemanticRole,
    countsCorroborate,
    detectOpRoleGroups,
} from '../src/components/operation-graph/opGraphOpRoles';
import bgeM3 from './fixtures/opRoles/bge_m3.json';
import moe from './fixtures/opRoles/moe.json';
import resnet50 from './fixtures/opRoles/resnet50.json';
import sentenceBert from './fixtures/opRoles/sentence_bert.json';

// Fixtures are the real op sequences from captured reports, not synthetic chains:
// the whole claim of #1976 is that production op names carry their own role, so a
// hand-written sequence would only prove the table matches itself.
const ofRole = (groups: readonly OpRoleGroup[], role: OpSemanticRole) => groups.filter((group) => group.role === role);

const sizesOf = (groups: readonly OpRoleGroup[]) => new Set(groups.map((group) => group.operationIds.length));

const operation = (id: number, name: string): OpRoleSourceOperation => ({ id, name });

describe('detectOpRoleGroups', () => {
    describe('a fused-attention transformer (bge_m3)', () => {
        const groups = detectOpRoleGroups(bgeM3.operations);

        it('finds one attention block per layer, named by the op itself', () => {
            const attention = ofRole(groups, OpSemanticRole.ATTENTION);

            expect(attention).toHaveLength(24);
            expect(attention.every((group) => group.confidence === OpRoleConfidence.HIGH)).toBe(true);
            // The head split precedes the fused op in execution order, so it is the
            // anchor that names the span; the fused op is what makes the span HIGH.
            expect(attention[0].anchorName).toBe('nlp_create_qkv_heads');
            const namesIn = (group: OpRoleGroup) =>
                group.operationIds.map((id) => bgeM3.operations.find((candidate) => candidate.id === id)?.name ?? '');
            expect(namesIn(attention[0]).some((name) => name.endsWith('scaled_dot_product_attention'))).toBe(true);
        });

        it('cuts every attention block to the same length, so the partition found real structure', () => {
            // 24 spans of identical size is the corroboration: a partition landing on
            // arbitrary boundaries would produce a spread, not one value.
            expect(sizesOf(ofRole(groups, OpSemanticRole.ATTENTION))).toEqual(new Set([25]));
            expect(sizesOf(ofRole(groups, OpSemanticRole.FEED_FORWARD))).toEqual(new Set([13]));
        });

        it('reports the feed-forward half at lower confidence than the attention half', () => {
            // `gelu` says something feed-forward happened; it does not name the block
            // the way `scaled_dot_product_attention` does.
            const feedForward = ofRole(groups, OpSemanticRole.FEED_FORWARD);

            expect(feedForward).toHaveLength(24);
            expect(feedForward.every((group) => group.confidence === OpRoleConfidence.MEDIUM)).toBe(true);
            expect(feedForward[0].anchorName).toBe('gelu');
        });

        it('finds the embedding, which no repeat scan can reach', () => {
            expect(ofRole(groups, OpSemanticRole.EMBEDDING)).toHaveLength(1);
        });

        it('accounts for every op it groups exactly once', () => {
            const owned = groups.flatMap((group) => group.operationIds);

            expect(new Set(owned).size).toBe(owned.length);
        });
    });

    describe('an unfused-attention transformer (sentence_bert)', () => {
        const groups = detectOpRoleGroups(sentenceBert.operations);

        it('recognises attention spelled as split + softmax rather than one fused op', () => {
            // The same semantic layer, a different signature. Without both spellings in
            // one anchor entry this report yields nothing. #1976
            const attention = ofRole(groups, OpSemanticRole.ATTENTION);

            expect(attention).toHaveLength(12);
            expect(attention.every((group) => group.confidence === OpRoleConfidence.HIGH)).toBe(true);
            expect(attention[0].anchorName).not.toBe('scaled_dot_product_attention');
            expect(sizesOf(attention)).toEqual(new Set([14]));
        });

        it('drops the feed-forward spans it cannot name instead of guessing', () => {
            // This capture has no activation op at all, so 12 spans exist between the
            // norms with nothing to identify them. Reporting them as feed-forward on
            // position alone is the inference this detector is meant to avoid.
            expect(ofRole(groups, OpSemanticRole.FEED_FORWARD)).toHaveLength(0);
        });
    });

    describe('a convolutional model with no normalisation (resnet50)', () => {
        const groups = detectOpRoleGroups(resnet50.operations);

        it('falls back to the residual add as the block boundary', () => {
            const blocks = ofRole(groups, OpSemanticRole.CONV_RESIDUAL);

            expect(blocks).toHaveLength(48);
            expect(blocks.every((group) => group.confidence === OpRoleConfidence.MEDIUM)).toBe(true);
        });

        it('matches op names through an architecture namespace', () => {
            // Every op here is `ttnn.experimental.quasar.*`. Exact-string matching would
            // miss the whole report, which is why anchors match on the name's leaf.
            expect(resnet50.operations.some((op) => op.name.includes('experimental.quasar.conv2d'))).toBe(true);
            expect(ofRole(groups, OpSemanticRole.CONV_RESIDUAL)[0].anchorName).toBe('conv2d');
        });
    });

    describe('a report whose vocabulary carries no roles (test_ttnn_moe)', () => {
        it('reports nothing rather than guessing', () => {
            // Documented negative case. This capture has `add` delimiters but no anchor
            // of any kind — no topk, no softmax, no expert ops — so partitioning finds
            // spans and correctly declines to name them. Ancestry (#1953) is the only
            // signal for this report, and claiming coverage here would be false. #1976
            expect(detectOpRoleGroups(moe.operations)).toHaveLength(0);
        });
    });

    describe('partitioning rules', () => {
        it('gives the trailing delimiter to the block it terminates', () => {
            const groups = detectOpRoleGroups([
                operation(1, 'ttnn.linear'),
                operation(2, 'ttnn.gelu'),
                operation(3, 'ttnn.layer_norm'),
                operation(4, 'ttnn.embedding'),
                operation(5, 'ttnn.layer_norm'),
            ]);

            expect(groups.map((group) => group.operationIds)).toEqual([
                [1, 2, 3],
                [4, 5],
            ]);
        });

        it('names a span by its strongest anchor, not the first one it meets', () => {
            const groups = detectOpRoleGroups([
                operation(1, 'ttnn.gelu'),
                operation(2, 'ttnn.transformer.scaled_dot_product_attention'),
                operation(3, 'ttnn.layer_norm'),
            ]);

            expect(groups).toHaveLength(1);
            expect(groups[0].role).toBe(OpSemanticRole.ATTENTION);
            expect(groups[0].confidence).toBe(OpRoleConfidence.HIGH);
        });

        it('ignores residual adds while normalisation is present', () => {
            // Residual adds outnumber block boundaries, so using both delimiters would
            // shatter each layer into fragments.
            const groups = detectOpRoleGroups([
                operation(1, 'ttnn.transformer.scaled_dot_product_attention'),
                operation(2, 'ttnn.add'),
                operation(3, 'ttnn.linear'),
                operation(4, 'ttnn.layer_norm'),
            ]);

            expect(groups).toHaveLength(1);
            expect(groups[0].operationIds).toEqual([1, 2, 3, 4]);
        });

        it('keeps a trailing span that no delimiter closes', () => {
            // An output head has no trailing norm, and dropping it would lose the region
            // repetition detection already cannot see.
            const groups = detectOpRoleGroups([operation(1, 'ttnn.layer_norm'), operation(2, 'ttnn.embedding')]);

            expect(groups.map((group) => group.operationIds)).toEqual([[2]]);
        });

        it('returns nothing for an empty graph', () => {
            expect(detectOpRoleGroups([])).toHaveLength(0);
        });
    });

    describe('countsCorroborate', () => {
        it('confirms four linears per attention block on a real report', () => {
            // 96 linears over 24 layers: QKV, attention output, MLP up, MLP down.
            expect(countsCorroborate(bgeM3.operations, 'linear', 24, 4)).toBe(true);
        });

        it('rejects a layer count the histogram does not divide by', () => {
            expect(countsCorroborate(bgeM3.operations, 'linear', 24, 3)).toBe(false);
            expect(countsCorroborate(bgeM3.operations, 'linear', 7, 4)).toBe(false);
        });

        it('refuses to corroborate against no groups', () => {
            expect(countsCorroborate(bgeM3.operations, 'linear', 0, 4)).toBe(false);
        });
    });
});
