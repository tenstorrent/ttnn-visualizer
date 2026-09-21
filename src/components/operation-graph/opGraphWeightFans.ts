// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { CandidateEdge } from './opGraphBuilder';
import type { OpGraphSourceOperation, RepeatBlockInstance } from './opGraphTypes';
import { OpGraphBlockKind } from './opGraphTypes';

/**
 * Collapses weight loading, which dominates the node count and is none of the model.
 *
 * `sentence_bert` spends 151 of its 406 operations on `ttnn.to_device`; `bge_m3` spends
 * 293 on `ttnn.from_torch`. Rendered, they are fans of source nodes pointing at each
 * layer — most of what is on screen and none of what anyone came to look at. #1980
 *
 * Matched topologically rather than by op name, because those two reports already
 * disagree about the name and a list would have missed one of them.
 */

/**
 * One member is not a fan: collapsing it replaces a node with a node, and it costs the
 * reader the tensor label that the member's own edge was carrying.
 */
const MIN_FAN_MEMBERS = 2;

const FAN_ID_PREFIX = 'weights:';

/**
 * Keyed on the whole membership, ascending, rather than on the first member.
 *
 * A fan's members are grouped by the node they feed, and *which* node that is depends
 * on what grouping just folded — so a fold that merges two consumers into one block
 * merges their fans. Keyed on the first member, the survivor of `[2,3]` + `[1]`
 * renamed itself from `weights:2` to `weights:1`, which is the same defect the re-key
 * was meant to end, reached by a different route: the reader's unrolled fan re-folded
 * and the old id was stranded in a set nothing prunes. #1988
 *
 * Two properties follow, and both are load-bearing. The id changes exactly when the
 * membership changes, so it can never silently name a different fan. And the members
 * are recoverable from the id, which is what lets a merge carry the reader's decision
 * forward without keeping any history of the previous build — see
 * `weightFanMembersOf`.
 *
 * Spelled out rather than hashed because fans are small: the largest across the local
 * captures holds three members, and #1980's own example is six per attention span. A
 * graph folded to a single block is the pathological case, where every source in the
 * report merges into one fan and the id grows with it.
 */
const fanIdOf = (memberOperationIds: readonly number[]): string =>
    `${FAN_ID_PREFIX}${[...memberOperationIds].sort((left, right) => left - right).join('-')}`;

/**
 * The operations a fan id names, or `null` for an id that is not a fan's.
 *
 * Callers use this to ask whether a remembered decision is about *these* operations,
 * which is the question that survives a merge — the id will not match, but the
 * membership overlaps.
 */
export const weightFanMembersOf = (instanceId: string): number[] | null => {
    if (!instanceId.startsWith(FAN_ID_PREFIX)) {
        return null;
    }
    const members = instanceId
        .slice(FAN_ID_PREFIX.length)
        .split('-')
        .map((part) => Number(part));
    return members.length > 0 && members.every((member) => Number.isSafeInteger(member)) ? members : null;
};

/**
 * Whether a remembered fan decision covers any of `memberOperationIds`.
 *
 * "Any", not "all": a merge makes one fan out of two, so the reader who opened either
 * of them opened part of this one, and re-folding it under them would be the failure
 * this is here to prevent.
 */
export const weightFanIdCovers = (instanceId: string, memberOperationIds: readonly number[]): boolean => {
    const remembered = weightFanMembersOf(instanceId);
    if (remembered === null) {
        return false;
    }
    const members = new Set(memberOperationIds);
    return remembered.some((member) => members.has(member));
};

export interface WeightFanInput {
    keptOperations: readonly OpGraphSourceOperation[];
    candidates: readonly CandidateEdge[];
    /** Kept ids, so an edge to a filtered-out op does not count as a consumer. */
    kept: ReadonlySet<number>;
    /** Resolves an operation to the node that currently draws it. */
    renderedNodeIdOf: (operationId: number) => string;
    /** Operations a grouping block already owns; a fan must never claim one twice. */
    isClaimed: (operationId: number) => boolean;
}

/**
 * Presented as `RepeatBlockInstance` so the fan reuses the folding machinery #1583
 * already built: once a member resolves to the fan, the existing edge path suppresses
 * the label and dedupes parallel edges across a collapsed boundary, which is the single
 * unlabelled edge this feature is for. Nothing new draws it.
 */
export const detectWeightFans = ({
    keptOperations,
    candidates,
    kept,
    renderedNodeIdOf,
    isClaimed,
}: WeightFanInput): RepeatBlockInstance[] => {
    const hasIncoming = new Set<number>();
    const consumersOf = new Map<number, Set<string>>();
    for (const candidate of candidates) {
        // Both ends have to survive the filter: an edge to a hidden op is not a second
        // consumer, and counting it would disqualify an otherwise sound fan.
        if (kept.has(candidate.source) && kept.has(candidate.target)) {
            hasIncoming.add(candidate.target);
            const seen = consumersOf.get(candidate.source) ?? new Set<string>();
            seen.add(renderedNodeIdOf(candidate.target));
            consumersOf.set(candidate.source, seen);
        }
    }

    // Grouped in operation order, so a fan's first member — where the node is emitted —
    // is the earliest of them and the graph keeps its reading order.
    const membersByConsumer = new Map<string, number[]>();
    for (const operation of keptOperations) {
        const isSource = !hasIncoming.has(operation.id) && !isClaimed(operation.id);
        const consumers = isSource ? consumersOf.get(operation.id) : undefined;
        // Exactly one consumer is the safety condition, not an optimisation: a source
        // feeding two nodes belongs to neither, and collapsing it into one of them would
        // have the graph assert a parameter is that layer's when it is shared.
        if (consumers !== undefined && consumers.size === 1) {
            const consumerNodeId = [...consumers][0];
            const members = membersByConsumer.get(consumerNodeId) ?? [];
            members.push(operation.id);
            membersByConsumer.set(consumerNodeId, members);
        }
    }

    const fans: RepeatBlockInstance[] = [];
    for (const operationIds of membersByConsumer.values()) {
        if (operationIds.length >= MIN_FAN_MEMBERS) {
            fans.push({
                kind: OpGraphBlockKind.WEIGHTS,
                instanceId: fanIdOf(operationIds),
                patternId: 'weights',
                label: `${operationIds.length} weight loads`,
                patternLabel: 'Weight loads',
                operationIds,
                instanceIndex: 0,
                instanceCount: 1,
            });
        }
    }
    return fans;
};
