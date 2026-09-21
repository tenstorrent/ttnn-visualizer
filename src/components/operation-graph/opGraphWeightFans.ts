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
/** At least one member, each a run of digits, separated by single hyphens. */
const FAN_ID_PATTERN = /^weights:\d+(?:-\d+)*$/;

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
 * Spelled out rather than hashed because fans are ordinarily small: the largest across
 * the local captures holds three members, and #1980's own example is six per attention
 * span. The bound is the report, though, not that observation — fold a graph to one
 * block and every source in it merges into a single fan, which on `sentence_bert`'s
 * 149 weight loads is a node id of roughly 700 characters. Legible ids were judged
 * worth that; a digest is the fallback if it stops being true.
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
    // Matched whole rather than split and checked: `''.split('-')` is `['']` and
    // `Number('')` is 0, so a bare `weights:` parsed to `[0]` and then "covered" every
    // fan holding operation 0, and `weights:1--2` parsed to `[1, 0, 2]`.
    if (!FAN_ID_PATTERN.test(instanceId)) {
        return null;
    }
    return instanceId
        .slice(FAN_ID_PREFIX.length)
        .split('-')
        .map((part) => Number(part));
};

/**
 * Whether a remembered fan decision covers any of `memberOperationIds`.
 *
 * One membership contains the other, in either direction — which is exactly the two
 * ways a fold reshapes a fan. A merge absorbs the remembered fan into a larger one
 * (`{2,3}` into `{1,2,3}`), and a split breaks it into smaller ones (`{1,4}` out of
 * `{1,2,3,4}`); both are still the fan the reader opened, so re-folding either under
 * them is the failure this is here to prevent.
 *
 * Bare intersection is too wide, and the difference is reachable: a decision about
 * `{1,2}` would unroll a later `{1,7,8}` that shares only operation 1, showing weight
 * loads the reader had deliberately left folded. Containment says "the fan I opened
 * became this one"; sharing a member says nothing.
 *
 * What containment keeps, deliberately, is the merge of two fans with opposite
 * decisions: they become one node and the open one wins, so sources left folded come
 * with it. One node cannot be half open, and showing the graph as captured is the
 * safer direction.
 */
export const weightFanIdCovers = (instanceId: string, memberOperationIds: readonly number[]): boolean => {
    const remembered = weightFanMembersOf(instanceId);
    return (
        remembered !== null &&
        weightFanMembersCover(rememberedDecision(remembered), memberOperationIds, new Set(memberOperationIds))
    );
};

/**
 * A remembered fan, decoded once.
 *
 * The builder holds one of these per remembered id for the whole build rather than
 * re-deriving it per fan: the check below runs for every fan, and parsing the id and
 * allocating a set inside that loop made the work grow with fans × remembered ids ×
 * membership. Measured at 6.2 ms per build on 200 fans against 500 remembered ids,
 * all of it parsing.
 */
export interface RememberedFan {
    members: readonly number[];
    memberSet: ReadonlySet<number>;
}

export const rememberedDecision = (members: readonly number[]): RememberedFan => ({
    members,
    memberSet: new Set(members),
});

/**
 * The containment rule itself, over memberships that are already decoded.
 *
 * `weightFanIdCovers` is this with a decode in front, so the rule has one
 * implementation and the hot path does not pay for the string.
 */
export const weightFanMembersCover = (
    remembered: RememberedFan,
    memberOperationIds: readonly number[],
    memberSet: ReadonlySet<number>,
): boolean =>
    remembered.members.every((member) => memberSet.has(member)) ||
    memberOperationIds.every((member) => remembered.memberSet.has(member));

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
