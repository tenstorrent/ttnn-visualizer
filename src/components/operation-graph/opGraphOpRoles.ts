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

/** Roles a span can be identified as. Ordered by classification priority. */
export enum OpSemanticRole {
    ATTENTION = 'attention',
    FEED_FORWARD = 'feedForward',
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
}

/**
 * Anchors are matched on the **leaf** of the op name, which is what makes matching
 * prefix-tolerant: ResNet arrives as `ttnn.experimental.quasar.conv2d` and attention
 * as `ttnn.transformer.scaled_dot_product_attention`, so an exact-string table would
 * miss whole architectures. #1976
 */
const leafNameOf = (name: string): string => name.slice(name.lastIndexOf('.') + 1);

/**
 * Fused and unfused spellings of one role sit in the same list. `bge_m3` emits a
 * single fused `scaled_dot_product_attention`; `sentence_bert` spells the identical
 * concept as `split_query_key_value_and_split_heads` + `attention_softmax_` + two
 * matmuls. Both are attention, and this set grows every time the backend fuses. #1976
 */
const NAMING_ANCHORS: ReadonlyMap<string, OpSemanticRole> = new Map([
    ['scaled_dot_product_attention', OpSemanticRole.ATTENTION],
    ['attention_softmax_', OpSemanticRole.ATTENTION],
    ['attention_softmax', OpSemanticRole.ATTENTION],
    ['split_query_key_value_and_split_heads', OpSemanticRole.ATTENTION],
    ['nlp_create_qkv_heads', OpSemanticRole.ATTENTION],
    ['embedding', OpSemanticRole.EMBEDDING],
]);

/**
 * Weaker evidence: an activation says "something feed-forward happened here" without
 * naming the block, and a convolution says even less on its own — it is the residual
 * boundary around it that makes the span a block. Reported as MEDIUM. #1976
 */
const SUPPORTING_ANCHORS: ReadonlyMap<string, OpSemanticRole> = new Map([
    ['gelu', OpSemanticRole.FEED_FORWARD],
    ['geglu', OpSemanticRole.FEED_FORWARD],
    ['silu', OpSemanticRole.FEED_FORWARD],
    ['relu', OpSemanticRole.FEED_FORWARD],
    ['conv2d', OpSemanticRole.CONV_RESIDUAL],
]);

/**
 * Normalisation terminates a transformer sub-block, so it is the delimiter wherever
 * it exists. `add` is not used while a norm is present: residual adds are far more
 * common than block boundaries and would shatter each layer into fragments.
 */
const NORMALISATION_DELIMITERS: ReadonlySet<string> = new Set(['layer_norm', 'rms_norm', 'group_norm', 'batch_norm']);

/**
 * The fallback for architectures with no normalisation in the capture. ResNet has
 * none, and there the residual add *is* the block boundary — partitioning 159 convs
 * on 48 adds yields 36 spans of exactly three, the canonical bottleneck. #1976
 */
const RESIDUAL_DELIMITERS: ReadonlySet<string> = new Set(['add', 'add_']);

const ROLE_LABELS: Readonly<Record<OpSemanticRole, string>> = {
    [OpSemanticRole.ATTENTION]: 'Attention',
    [OpSemanticRole.FEED_FORWARD]: 'Feed-forward',
    [OpSemanticRole.EMBEDDING]: 'Embedding',
    [OpSemanticRole.CONV_RESIDUAL]: 'Residual conv block',
};

/** Priority order, so a span holding both an attention anchor and an activation reads as attention. */
const ROLE_PRIORITY: readonly OpSemanticRole[] = [
    OpSemanticRole.ATTENTION,
    OpSemanticRole.FEED_FORWARD,
    OpSemanticRole.EMBEDDING,
    OpSemanticRole.CONV_RESIDUAL,
];

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

interface SpanClassification {
    role: OpSemanticRole;
    confidence: OpRoleConfidence;
    anchorName: string;
}

/**
 * A span is named by the highest-priority anchor it holds. A span with no anchor is
 * not a layer — it is the `from_torch` weight-loading run between two of them, and
 * returning `null` is how those are dropped rather than guessed at.
 */
const classifySpan = (leaves: readonly string[]): SpanClassification | null => {
    const found = new Map<OpSemanticRole, SpanClassification>();
    for (const leaf of leaves) {
        const naming = NAMING_ANCHORS.get(leaf);
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
    for (const role of ROLE_PRIORITY) {
        const hit = found.get(role);
        if (hit !== undefined) {
            return hit;
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
    const leaves = operations.map((operation) => leafNameOf(operation.name));
    const delimiters = delimitersFor(leaves);

    const groups: OpRoleGroup[] = [];
    let spanStart = 0;

    const closeSpan = (endExclusive: number): void => {
        if (endExclusive <= spanStart) {
            return;
        }
        const spanLeaves = leaves.slice(spanStart, endExclusive);
        const classification = classifySpan(spanLeaves);
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

/**
 * Cheap corroboration that needs no detector: if a role really repeats N times, the
 * op histogram divides by N. `bge_m3` has 96 `linear` over 24 attention blocks (four
 * per layer) and 49 `layer_norm` (two per layer plus the embedding norm). A count
 * that does not divide is the signal that the grouping is wrong. #1976
 */
export const countsCorroborate = (
    operations: readonly OpRoleSourceOperation[],
    opLeafName: string,
    groupCount: number,
    perGroup: number,
): boolean => {
    if (groupCount <= 0) {
        return false;
    }
    const total = operations.filter((operation) => leafNameOf(operation.name) === opLeafName).length;
    return total === groupCount * perGroup;
};
