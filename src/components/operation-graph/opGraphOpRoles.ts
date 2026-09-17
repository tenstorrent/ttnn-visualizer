// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Semantic grouping from op roles, independent of repetition (#1583) and of stack
 * ancestry (#1953). Many ttnn ops are named for what they do, so an attention block
 * is asserted by the framework rather than inferred — and unlike repetition, that
 * reaches the unique regions (embeddings, output heads) a repeat scan cannot see.
 *
 * #1976
 */

import { shortOperationName } from './opGraphOpNames';

/** Roles a span can be identified as. Ordered by classification priority. */
export enum OpSemanticRole {
    ATTENTION = 'attention',
    /** Expert routing. Ranked above feed-forward because MoE replaces it. */
    MOE = 'moe',
    FEED_FORWARD = 'feedForward',
    POSITIONAL_ENCODING = 'positionalEncoding',
    EMBEDDING = 'embedding',
    CONV_RESIDUAL = 'convResidual',
}

/**
 * A role is reported, never asserted: the same operations may reasonably be grouped
 * more than one way, so the caller gets to decide how much to trust this. #1976
 */
export enum OpRoleConfidence {
    /** A naming anchor — the op itself says what the span is. */
    HIGH = 'high',
    /** Identified by a supporting anchor, e.g. an activation or a convolution. */
    MEDIUM = 'medium',
}

export interface OpRoleGroup {
    role: OpSemanticRole;
    label: string;
    operationIds: number[];
    confidence: OpRoleConfidence;
    /** The op whose name carried the role, for explaining the group to a reader. */
    anchorName: string;
}

export interface OpRoleSourceOperation {
    id: number;
    name: string;
    /**
     * An activation ttnn fused into this op instead of emitting it separately, already
     * reduced to its bare lowercase name by `fusedActivationOf`. It is classified as
     * though it were an op leaf, which is why one anchor table serves both spellings.
     * #1976
     */
    fusedActivation?: string;
}

/**
 * A span this large does not mean the layer is big — it means the partition failed,
 * and folding it replaces the model with one box. Past this a span is reported as no
 * grouping rather than as one useless block.
 *
 * Measured: the largest real span is 6.6% of `resnet50` and 3.7% of `bge_m3`, and the
 * smallest that must be rejected is 41% (`test_ttnn_moe`, whose whole graph comes back
 * as one span) — so anything in 0.07–0.40 behaves identically on the four captures and
 * 0.25 is the middle of that band. #1976
 */
const MAX_LAYER_SPAN_FRACTION = 0.25;

/**
 * The fraction alone is meaningless on a small graph, where one legitimate layer can
 * be most of it — a five-op chain has no "quarter of the model". Set above the largest
 * span measured in a real report so it admits real layers and leaves the fraction to
 * decide on graphs big enough for the question to mean anything.
 *
 * The margin is thinner than it looks: 26 ops is `bge_m3`'s embedding span *after*
 * hide-deallocate, and detection sees the raw 30 when that filter is off. Two ops of
 * headroom, and on a graph of 32 or fewer this floor readmits the whole-graph span the
 * bound exists to reject.
 */
const MIN_LAYER_SPAN_ALLOWANCE = 32;

/**
 * Fused and unfused spellings of one role sit in the same list. `bge_m3` emits a
 * single fused `scaled_dot_product_attention`; `sentence_bert` spells the identical
 * concept as `split_query_key_value_and_split_heads` + `attention_softmax_` + two
 * matmuls. Both are attention, and this set grows every time the backend fuses. #1976
 */
const NAMING_ANCHORS: ReadonlyMap<string, OpSemanticRole> = new Map([
    ['attention_softmax', OpSemanticRole.ATTENTION],
    ['attention_softmax_', OpSemanticRole.ATTENTION],
    ['split_query_key_value_and_split_heads', OpSemanticRole.ATTENTION],
    ['concatenate_heads', OpSemanticRole.ATTENTION],
    // Exact rather than a family: `embedding_backward` is a real op and is not an
    // embedding layer, so a prefix here would claim the backward pass.
    ['embedding', OpSemanticRole.EMBEDDING],
    // Expert routing, named outright by `ttnn.experimental.deepseek_prefill.*` and
    // `ttnn::operations::reduction::moe`. The generic `dispatch` / `combine` leaves
    // from that namespace are deliberately absent — they are ordinary words that a
    // non-MoE op could carry, and they fall inside the span these anchors already
    // claim. #1976
    ['moe', OpSemanticRole.MOE],
    ['moe_grouped_topk', OpSemanticRole.MOE],
    ['moe_hash_gate', OpSemanticRole.MOE],
    ['routed_expert_ffn', OpSemanticRole.MOE],
    ['unified_routed_expert_ffn', OpSemanticRole.MOE],
    ['unified_routed_expert_moe', OpSemanticRole.MOE],
    ['post_combine_reduce', OpSemanticRole.MOE],
]);

/**
 * Families matched on a leading segment, because metal ships each of these as a set
 * of variants and an exact table silently misses whole report classes: attention
 * alone has `scaled_dot_product_attention_decode` for the decode phase and
 * `nlp_create_qkv_heads_{decode,vit,falcon7b,segformer,boltz}` per model. Every entry
 * here is a family whose members all carry the same role, so a prefix cannot
 * over-claim. #1976
 */
const NAMING_ANCHOR_FAMILIES: readonly { readonly prefix: string; readonly role: OpSemanticRole }[] = [
    { prefix: 'scaled_dot_product_attention', role: OpSemanticRole.ATTENTION },
    { prefix: 'nlp_create_qkv_heads', role: OpSemanticRole.ATTENTION },
    { prefix: 'nlp_concat_heads', role: OpSemanticRole.ATTENTION },
    { prefix: 'rotary_embedding', role: OpSemanticRole.POSITIONAL_ENCODING },
];

/**
 * Weaker evidence: an activation says "something feed-forward happened here" without
 * naming the block, and a convolution says even less on its own — it is the residual
 * boundary around it that makes the span a block. Reported as MEDIUM. #1976
 */
const SUPPORTING_ANCHORS: ReadonlyMap<string, OpSemanticRole> = new Map([
    // The gated family is the modern default (`swiglu` in Llama and Mistral) and all
    // four exist in ttnn; only `geglu` was here before.
    ['gelu', OpSemanticRole.FEED_FORWARD],
    ['gelu_tanh', OpSemanticRole.FEED_FORWARD],
    ['geglu', OpSemanticRole.FEED_FORWARD],
    ['glu', OpSemanticRole.FEED_FORWARD],
    ['reglu', OpSemanticRole.FEED_FORWARD],
    ['swiglu', OpSemanticRole.FEED_FORWARD],
    ['silu', OpSemanticRole.FEED_FORWARD],
    ['relu', OpSemanticRole.FEED_FORWARD],
    ['relu6', OpSemanticRole.FEED_FORWARD],
    ['mish', OpSemanticRole.FEED_FORWARD],
    // ttnn's own activation table also lists `log`, `sqrt`, `sigmoid` and `tanh`.
    // Those are deliberately excluded: "supported as an activation" is a wider
    // category than "identifies a feed-forward block", and a `sqrt` inside a norm
    // would otherwise name the span.
    ['conv1d', OpSemanticRole.CONV_RESIDUAL],
    ['conv2d', OpSemanticRole.CONV_RESIDUAL],
    ['conv_transpose2d', OpSemanticRole.CONV_RESIDUAL],
]);

/**
 * Normalisation terminates a transformer sub-block, so it is the delimiter wherever
 * it exists. `add` is not used while a norm is present: residual adds are far more
 * common than block boundaries and would shatter each layer into fragments.
 */
const NORMALISATION_OPS: ReadonlySet<string> = new Set([
    'layer_norm',
    'rms_norm',
    'group_norm',
    'batch_norm',
    // The distributed spellings, which is what a multi-device transformer actually
    // emits. Without them such a report finds no norm at all and falls through to the
    // residual add, shattering every layer — and multi-device is the case this tool
    // exists for. #1976
    'layer_norm_pre_all_gather',
    'layer_norm_post_all_gather',
    'rms_norm_pre_all_gather',
    'rms_norm_post_all_gather',
]);

/**
 * ttnn files the softmax family under `operations/normalization/`, and adopting that
 * category wholesale would be wrong here: `softmax`, `scale_mask_softmax` and friends
 * sit *inside* attention, so treating them as delimiters would cut every attention
 * block in half. Metal's taxonomy answers "what kind of maths is this", which is not
 * the same question as "where does a layer end". #1976
 */
const NON_DELIMITING_NORMALISATION: ReadonlySet<string> = new Set([
    'softmax',
    'softmax_in_place',
    'scale_mask_softmax',
    'scale_mask_softmax_in_place',
    'scale_causal_mask_hw_dims_softmax_in_place',
]);

/**
 * Subtracted rather than merely documented: the next person to widen the list above
 * from ttnn's `normalization` directory would otherwise pull the softmax family in
 * with it and quietly halve every attention block.
 */
const NORMALISATION_DELIMITERS: ReadonlySet<string> = new Set(
    [...NORMALISATION_OPS].filter((leaf) => !NON_DELIMITING_NORMALISATION.has(leaf)),
);

/**
 * The fallback for architectures with no normalisation in the capture. ResNet has
 * none, and there the residual add *is* the block boundary — partitioning 159 convs
 * on 48 adds yields 36 spans of exactly three, the canonical bottleneck. #1976
 */
const RESIDUAL_DELIMITERS: ReadonlySet<string> = new Set(['add', 'add_']);

const ROLE_LABELS: Readonly<Record<OpSemanticRole, string>> = {
    [OpSemanticRole.ATTENTION]: 'Attention',
    [OpSemanticRole.MOE]: 'Expert routing',
    [OpSemanticRole.FEED_FORWARD]: 'Feed-forward',
    [OpSemanticRole.POSITIONAL_ENCODING]: 'Positional encoding',
    [OpSemanticRole.EMBEDDING]: 'Embedding',
    [OpSemanticRole.CONV_RESIDUAL]: 'Residual conv block',
};

/**
 * Breaks ties *within* one confidence level; confidence itself decides first. Listing
 * the roles alone was not enough, because it put feed-forward — which only ever comes
 * from a supporting anchor — above two roles an op names outright: a span of
 * `embedding, gelu, layer_norm` read as feed-forward and threw the embedding away.
 */
const ROLE_PRIORITY: readonly OpSemanticRole[] = [
    OpSemanticRole.ATTENTION,
    OpSemanticRole.MOE,
    OpSemanticRole.POSITIONAL_ENCODING,
    OpSemanticRole.EMBEDDING,
    // Above feed-forward, though both are supporting anchors: a convolution names a
    // shape, an activation only says one happened, and every conv block contains one.
    // `conv2d, relu, add` read as feed-forward before this, which is a residual conv
    // block in every CNN that emits its activation as an op.
    OpSemanticRole.CONV_RESIDUAL,
    OpSemanticRole.FEED_FORWARD,
];

/** Direct evidence before circumstantial: an op that names the role wins. */
const CONFIDENCE_PRIORITY: readonly OpRoleConfidence[] = [OpRoleConfidence.HIGH, OpRoleConfidence.MEDIUM];

/**
 * Named, and lifted out of the span loop where it recomputed one `Math.max` per span
 * from a value that depends only on the graph.
 */
const isSpanTooLarge = (spanLength: number, graphLength: number): boolean =>
    spanLength > Math.max(MIN_LAYER_SPAN_ALLOWANCE, graphLength * MAX_LAYER_SPAN_FRACTION);

/**
 * Normalisation when the capture has any, residual adds otherwise. Chosen from the
 * whole graph rather than per span: a graph that mixes both would otherwise partition
 * inconsistently down its length.
 */
const delimitersFor = (leaves: readonly string[]): ReadonlySet<string> => {
    if (leaves.some((leaf) => NORMALISATION_DELIMITERS.has(leaf))) {
        return NORMALISATION_DELIMITERS;
    }
    return RESIDUAL_DELIMITERS;
};

const familyRoleOf = (leaf: string): OpSemanticRole | undefined =>
    NAMING_ANCHOR_FAMILIES.find((family) => leaf.startsWith(family.prefix))?.role;

interface SpanClassification {
    role: OpSemanticRole;
    confidence: OpRoleConfidence;
    anchorName: string;
}

/**
 * A span is named by the strongest anchor it holds: an op that says what the span is
 * outranks one that merely suggests it, and `ROLE_PRIORITY` settles the rest. A span
 * with no anchor is not a layer — it is the `from_torch` weight-loading run between
 * two of them, and returning `null` is how those are dropped rather than guessed at.
 */
const classifySpan = (anchorLeaves: readonly string[]): SpanClassification | null => {
    const found = new Map<OpSemanticRole, SpanClassification>();
    for (const leaf of anchorLeaves) {
        const naming = NAMING_ANCHORS.get(leaf) ?? familyRoleOf(leaf);
        const role = naming ?? SUPPORTING_ANCHORS.get(leaf);
        // First anchor per role wins, so the span is named by the op a reader meets
        // first in execution order rather than by whichever table was consulted last.
        if (role !== undefined && !found.has(role)) {
            found.set(role, {
                role,
                confidence: naming === undefined ? OpRoleConfidence.MEDIUM : OpRoleConfidence.HIGH,
                anchorName: leaf,
            });
        }
    }
    for (const confidence of CONFIDENCE_PRIORITY) {
        for (const role of ROLE_PRIORITY) {
            const hit = found.get(role);
            if (hit?.confidence === confidence) {
                return hit;
            }
        }
    }
    return null;
};

/**
 * Partition the execution order on delimiters, then label each span by its anchors.
 *
 * Partition-then-label rather than grow-from-anchor: growing outward needs a stop
 * rule per role and produces overlapping spans where two anchors are close, while the
 * delimiters are already unambiguous and give each op exactly one owner.
 */
export const detectOpRoleGroups = (operations: readonly OpRoleSourceOperation[]): OpRoleGroup[] => {
    // Anchors match the leaf: ResNet arrives as `ttnn.experimental.quasar.conv2d`,
    // so an exact-string table on the full name misses whole architectures.
    const leaves = operations.map((operation) => shortOperationName(operation.name));
    const fusedActivations = operations.map((operation) => operation.fusedActivation);
    const delimiters = delimitersFor(leaves);

    const groups: OpRoleGroup[] = [];
    let spanStart = 0;

    const closeSpan = (endExclusive: number): void => {
        if (endExclusive <= spanStart) {
            return;
        }
        const spanLeaves = leaves.slice(spanStart, endExclusive);
        // Fused activations extend what the span can be *identified* by, never how it is
        // cut: they are appended for classification only. Adding them to `leaves` would
        // desynchronise the indices the partition and `operationIds` both rely on, and an
        // activation is not a boundary in any case.
        const spanAnchors = [
            ...spanLeaves,
            ...fusedActivations.slice(spanStart, endExclusive).filter((leaf) => leaf !== undefined),
        ];
        const classification = isSpanTooLarge(spanLeaves.length, leaves.length) ? null : classifySpan(spanAnchors);
        if (classification !== null) {
            groups.push({
                role: classification.role,
                label: ROLE_LABELS[classification.role],
                operationIds: operations.slice(spanStart, endExclusive).map((operation) => operation.id),
                confidence: classification.confidence,
                anchorName: classification.anchorName,
            });
        }
        spanStart = endExclusive;
    };

    for (let index = 0; index < leaves.length; index += 1) {
        if (delimiters.has(leaves[index])) {
            // Inclusive of the delimiter: the trailing norm belongs to the sub-block
            // it terminates, which is where a reader looks for it.
            closeSpan(index + 1);
        }
    }
    // Whatever follows the last delimiter — an output head has no trailing norm.
    closeSpan(leaves.length);

    return groups;
};
