// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type OpRoleGroup, OpSemanticRole, detectOpRoleGroups } from './opGraphOpRoles';
import type { OpGraphSourceOperation, RepeatBlockInstance } from './opGraphTypes';

/**
 * Folding a single operation replaces one node with one node, so a span that short
 * costs a click and buys nothing.
 */
const MIN_LAYER_BLOCK_OPS = 2;

/**
 * Presents role groups (#1976) as `RepeatBlockInstance`, which is what lets layer
 * grouping reuse every part of the folding machinery #1583 already built — block
 * nodes, expanders, edge remapping across a folded boundary, buried filter matches
 * and the block panel. A second block type would have duplicated all of it to render
 * the same shape: a labelled, foldable span of consecutive operations.
 *
 * The two detectors stay mutually exclusive per build, which is how a region avoids
 * carrying two competing identities — the open reconciliation question in #1953.
 */
export const detectLayerBlocks = (operations: readonly OpGraphSourceOperation[]): RepeatBlockInstance[] => {
    const groups = detectOpRoleGroups(operations).filter((group) => group.operationIds.length >= MIN_LAYER_BLOCK_OPS);

    // Counted up front so every instance can name its total: "Attention 3" is only
    // meaningful next to a count, and the panel shows "instance 3 of 24".
    const totalByRole = new Map<OpSemanticRole, number>();
    for (const group of groups) {
        totalByRole.set(group.role, (totalByRole.get(group.role) ?? 0) + 1);
    }

    const seenByRole = new Map<OpSemanticRole, number>();
    return groups.map((group: OpRoleGroup): RepeatBlockInstance => {
        const instanceIndex = (seenByRole.get(group.role) ?? 0) + 1;
        seenByRole.set(group.role, instanceIndex);
        const instanceCount = totalByRole.get(group.role) ?? 1;
        return {
            // Keyed on the first member rather than the index, so folding one instance
            // cannot rename the others when detection shifts by a span.
            instanceId: `layer:${group.role}:${group.operationIds[0]}`,
            patternId: `layer:${group.role}`,
            label: instanceCount > 1 ? `${group.label} ${instanceIndex}` : group.label,
            patternLabel: group.label,
            operationIds: group.operationIds,
            instanceIndex,
            instanceCount,
        };
    });
};
