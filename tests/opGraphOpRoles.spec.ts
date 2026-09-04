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

        it('finds the feed-forward halves through an activation fused into the matmul', () => {
            // This test previously asserted the opposite, and the comment justifying it
            // was wrong. It read: "no activation op at all, so 12 spans exist between the
            // norms with nothing to identify them". The first half is true — there is no
            // activation *op* — but the conclusion was not: every one of those 12 spans
            // carries `fused_activation=UnaryWithParam(op_type=UnaryOpType::GELU)` in its
            // matmul `program_config`. The evidence was in an argument, and reading only
            // op names could not see it, so the suite recorded a false negative as if it
            // were correct behaviour. #1976
            const feedForward = ofRole(groups, OpSemanticRole.FEED_FORWARD);

            expect(feedForward).toHaveLength(12);
            expect(feedForward.every((group) => group.anchorName === 'gelu')).toBe(true);
            // MEDIUM, the same standing as an explicit `ttnn.gelu` op: an activation says
            // something feed-forward happened without naming the block.
            expect(feedForward.every((group) => group.confidence === OpRoleConfidence.MEDIUM)).toBe(true);
            // Uniform, which is what says the partition found real structure rather than
            // that the new anchor started matching arbitrary spans.
            expect(sizesOf(feedForward)).toEqual(new Set([5]));
        });

        it('pairs one feed-forward with each attention block', () => {
            // 12 layers, each attention + feed-forward. Before the fused anchor this
            // report yielded 12 groups; it now yields 24.
            expect(groups).toHaveLength(24);
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

    describe('a mixture-of-experts report (test_ttnn_moe)', () => {
        it('names expert routing wherever a boundary exists to hold it', () => {
            // The anchors come from ttnn itself: `deepseek_prefill.moe_grouped_topk` is
            // the router and `reduction/moe` is a first-class op.
            const groups = detectOpRoleGroups([
                operation(1, 'ttnn.experimental.deepseek_prefill.moe_grouped_topk'),
                operation(2, 'ttnn.experimental.deepseek_prefill.dispatch'),
                operation(3, 'ttnn.layer_norm'),
            ]);

            expect(groups[0].role).toBe(OpSemanticRole.MOE);
            expect(groups[0].anchorName).toBe('moe_grouped_topk');
        });

        it('declines this report, whose partition leaves no boundary to fold on', () => {
            // Two corrections in one place. It was first written up as inert, which was
            // wrong — the routing ops are all there, each appearing once and so sitting
            // below the frequency cutoff used to read the vocabulary. But naming them
            // did not make the report groupable: it carries one `add` and no
            // normalisation, so the only span is the entire graph, and folding that
            // replaces the model with a single box.
            //
            // So it yields nothing, for a different reason than first claimed. The gap
            // is a delimiter for expert graphs — `dispatch` and `combine` bracket the
            // region — not the anchors. #1976
            expect(detectOpRoleGroups(moe.operations)).toHaveLength(0);
        });

        it('still declines to name a span that holds only plumbing', () => {
            // The real negative case, stated as data rather than as a claim about a
            // report: transfers and reshapes carry no role and must not acquire one.
            const groups = detectOpRoleGroups([
                operation(1, 'ttnn.from_torch'),
                operation(2, 'ttnn.to_device'),
                operation(3, 'ttnn.squeeze'),
                operation(4, 'ttnn.add'),
                operation(5, 'ttnn.reshape'),
            ]);

            expect(groups).toHaveLength(0);
        });
    });

    describe('families ttnn ships as variants', () => {
        it('matches the decode-phase attention op, not just the prefill one', () => {
            // `scaled_dot_product_attention_decode` is what an autoregressive trace
            // emits, and an exact-leaf table missed every decode report. #1976
            const groups = detectOpRoleGroups([
                operation(1, 'ttnn.transformer.scaled_dot_product_attention_decode'),
                operation(2, 'ttnn.layer_norm'),
            ]);

            expect(groups[0].role).toBe(OpSemanticRole.ATTENTION);
            expect(groups[0].confidence).toBe(OpRoleConfidence.HIGH);
        });

        it('matches the per-model qkv head variants', () => {
            for (const variant of [
                'nlp_create_qkv_heads_decode',
                'nlp_create_qkv_heads_vit',
                'nlp_create_qkv_heads_falcon7b',
                'nlp_create_qkv_heads_segformer',
            ]) {
                const groups = detectOpRoleGroups([
                    operation(1, `ttnn.experimental.${variant}`),
                    operation(2, 'ttnn.layer_norm'),
                ]);

                expect(groups[0]?.role).toBe(OpSemanticRole.ATTENTION);
            }
        });

        it('treats the distributed norm spellings as boundaries', () => {
            // A multi-device transformer emits these instead of `layer_norm`. Without
            // them the graph finds no norm and falls through to the residual add,
            // shattering every layer — and multi-device is this tool's whole point.
            const groups = detectOpRoleGroups([
                operation(1, 'ttnn.transformer.scaled_dot_product_attention'),
                operation(2, 'ttnn.add'),
                operation(3, 'ttnn.layer_norm_post_all_gather'),
                operation(4, 'ttnn.gelu'),
                operation(5, 'ttnn.rms_norm_post_all_gather'),
            ]);

            expect(groups.map((group) => group.operationIds)).toEqual([
                [1, 2, 3],
                [4, 5],
            ]);
        });

        it('recognises the gated activations, swiglu included', () => {
            for (const activation of ['swiglu', 'geglu', 'reglu', 'glu', 'gelu_tanh']) {
                const groups = detectOpRoleGroups([
                    operation(1, `ttnn.${activation}`),
                    operation(2, 'ttnn.layer_norm'),
                ]);

                expect(groups[0]?.role).toBe(OpSemanticRole.FEED_FORWARD);
            }
        });
    });

    describe("where metal's taxonomy must not be adopted wholesale", () => {
        it('does not cut a block on softmax, which ttnn files under normalization', () => {
            // `operations/normalization/softmax` answers "what kind of maths is this",
            // not "where does a layer end". Using it as a delimiter would halve every
            // attention block, since the softmax sits inside one. #1976
            const groups = detectOpRoleGroups([
                operation(1, 'ttnn.experimental.nlp_create_qkv_heads'),
                operation(2, 'ttnn.scale_mask_softmax_in_place'),
                operation(3, 'ttnn.experimental.nlp_concat_heads'),
                operation(4, 'ttnn.layer_norm'),
            ]);

            expect(groups).toHaveLength(1);
            expect(groups[0].operationIds).toEqual([1, 2, 3, 4]);
            expect(groups[0].role).toBe(OpSemanticRole.ATTENTION);
        });

        it('ranks expert routing above the activation inside it', () => {
            // An expert block contains a feed-forward activation, so the generic
            // evidence must not outrank the specific.
            const groups = detectOpRoleGroups([
                operation(1, 'ttnn.experimental.deepseek_prefill.moe_grouped_topk'),
                operation(2, 'ttnn.silu'),
                operation(3, 'ttnn.layer_norm'),
            ]);

            expect(groups[0].role).toBe(OpSemanticRole.MOE);
        });
    });

    describe('the sequence production actually detects on', () => {
        // `hideDeallocate` defaults on, so the builder detects over `getKeptOperations`,
        // not the raw capture. The group *counts* are identical either way — which is
        // what the acceptance criteria are about — but every span size differs, and the
        // sizes are this suite's corroboration idiom, so they have to corroborate the
        // view that ships. The node labels bear this out: `sentence_bert`'s attention
        // block renders "9 ops", which is the filtered figure, not the raw 14. #1976
        const withoutDeallocate = (operations: readonly OpRoleSourceOperation[]) =>
            operations.filter((candidate) => !candidate.name.endsWith('deallocate'));

        it('finds the same groups with deallocate ops hidden', () => {
            expect(detectOpRoleGroups(withoutDeallocate(bgeM3.operations))).toHaveLength(49);
            expect(detectOpRoleGroups(withoutDeallocate(sentenceBert.operations))).toHaveLength(24);
            expect(detectOpRoleGroups(withoutDeallocate(resnet50.operations))).toHaveLength(48);
        });

        it('keeps every span uniform in the view, at the sizes a reader sees', () => {
            const filtered = detectOpRoleGroups(withoutDeallocate(bgeM3.operations));

            expect(sizesOf(ofRole(filtered, OpSemanticRole.ATTENTION))).toEqual(new Set([17]));
            expect(sizesOf(ofRole(filtered, OpSemanticRole.FEED_FORWARD))).toEqual(new Set([11]));

            const sbert = detectOpRoleGroups(withoutDeallocate(sentenceBert.operations));

            expect(sizesOf(ofRole(sbert, OpSemanticRole.ATTENTION))).toEqual(new Set([9]));
            expect(sizesOf(ofRole(sbert, OpSemanticRole.FEED_FORWARD))).toEqual(new Set([4]));
        });

        it('keeps the three-conv bottleneck dominant in resnet50', () => {
            // A stated acceptance criterion that nothing pinned: the delimiter set could
            // change and only the total would stay 48.
            const blocks = ofRole(
                detectOpRoleGroups(withoutDeallocate(resnet50.operations)),
                OpSemanticRole.CONV_RESIDUAL,
            );
            const convsPerBlock = blocks.map(
                (block) =>
                    block.operationIds.filter((id) =>
                        (resnet50.operations.find((candidate) => candidate.id === id)?.name ?? '').endsWith('conv2d'),
                    ).length,
            );
            const distribution = convsPerBlock.reduce<Record<number, number>>((counts, convs) => {
                counts[convs] = (counts[convs] ?? 0) + 1;
                return counts;
            }, {});

            expect(distribution[3]).toBe(36);
            expect(Object.keys(distribution).sort()).toEqual(['3', '4', '5']);
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

        it('lets a fused activation identify a span without ever cutting one', () => {
            // The activation extends what a span can be identified *by*, never how it is
            // cut. If it reached the delimiter list — or the array the partition indexes —
            // it would either split the block it identifies or desynchronise
            // `operationIds` from the spans. One span of all three ops, named by the
            // fused activation on the middle one.
            const groups = detectOpRoleGroups([
                { id: 1, name: 'ttnn.linear' },
                { id: 2, name: 'ttnn.linear', fusedActivation: 'gelu' },
                { id: 3, name: 'ttnn.layer_norm' },
            ]);

            expect(groups).toHaveLength(1);
            expect(groups[0].role).toBe(OpSemanticRole.FEED_FORWARD);
            expect(groups[0].operationIds).toEqual([1, 2, 3]);
            expect(groups[0].anchorName).toBe('gelu');
        });

        it('prefers a naming anchor in the span over a fused activation', () => {
            // Priority is unchanged by the new evidence: attention still outranks
            // feed-forward, however the activation arrived.
            const groups = detectOpRoleGroups([
                { id: 1, name: 'ttnn.linear', fusedActivation: 'gelu' },
                { id: 2, name: 'ttnn.transformer.scaled_dot_product_attention' },
                { id: 3, name: 'ttnn.layer_norm' },
            ]);

            expect(groups[0].role).toBe(OpSemanticRole.ATTENTION);
            expect(groups[0].confidence).toBe(OpRoleConfidence.HIGH);
        });

        it('ignores a fused activation it does not recognise', () => {
            // The tables are the vocabulary, not the argument. A future UnaryOpType we
            // have not classified must not become a feed-forward block by default.
            const groups = detectOpRoleGroups([
                { id: 1, name: 'ttnn.linear', fusedActivation: 'some_new_thing' },
                { id: 2, name: 'ttnn.layer_norm' },
            ]);

            expect(groups).toHaveLength(0);
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
