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

/**
 * Keyed on the fan's first member, not on the node it feeds. The consumer's *rendered*
 * id is what the grouping fold moves — a fan feeding an op inside a layer is
 * `weights:layer:attention:4` folded and `weights:4` unrolled — so keying on it meant a
 * fan the user had unrolled re-folded itself the moment that layer was folded, and left
 * the old id behind in a set nothing prunes. A member is a source operation, never
 * inside a grouping block, so its id does not move. #1980
 */
const fanIdOf = (firstMemberOperationId: number): string => `weights:${firstMemberOperationId}`;

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
                instanceId: fanIdOf(operationIds[0]),
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
