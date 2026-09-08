// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NodeRelation } from '../../definitions/NodeRelation';
import type { OperationDescription, Tensor } from '../../model/APIData';

/**
 * @description Rewrite a tensor's endpoints to only those outside the block, so a
 * boundary tensor names what it actually connects the block to rather than listing
 * members the panel is already showing.
 *
 * Ids and names are two arrays aligned by index, so they are filtered as pairs and
 * rebuilt together; filtering the ids alone would shift every name by one and
 * attribute a boundary tensor to the wrong operation. A missing name becomes '',
 * which keeps the pairing rather than collapsing the list.
 */
export const withExternalEndpoints = (
    tensor: Tensor,
    memberIds: ReadonlySet<number>,
    direction: NodeRelation,
): Tensor => {
    if (direction === NodeRelation.Input) {
        const producers = tensor.producers ?? [];
        const producerNames = tensor.producerNames ?? [];
        const keep = producers
            .map((id, index) => ({ id, name: producerNames[index] ?? '' }))
            .filter((entry) => !memberIds.has(entry.id));
        return { ...tensor, producers: keep.map((entry) => entry.id), producerNames: keep.map((entry) => entry.name) };
    }
    const consumers = tensor.consumers ?? [];
    const consumerNames = tensor.consumerNames ?? [];
    const keep = consumers
        .map((id, index) => ({ id, name: consumerNames[index] ?? '' }))
        .filter((entry) => !memberIds.has(entry.id));
    return { ...tensor, consumers: keep.map((entry) => entry.id), consumerNames: keep.map((entry) => entry.name) };
};

/**
 * @description The block's I/O in one direction: tensors that cross its boundary,
 * deduplicated by tensor id and with their endpoints narrowed to the outside.
 *
 * A tensor with no counterparts at all is kept — it is a graph input or output, not
 * an internal edge — while one whose every counterpart is a member is dropped as
 * internal to the block.
 */
export const getBlockBoundaryTensors = (
    members: OperationDescription[],
    memberIds: ReadonlySet<number>,
    direction: NodeRelation,
): Tensor[] => {
    const tensors: Tensor[] = [];
    const seenIds = new Set<number>();
    for (const member of members) {
        const list = (direction === NodeRelation.Input ? member.inputs : member.outputs) ?? [];
        for (const tensor of list) {
            if (!seenIds.has(tensor.id)) {
                const counterparts = (direction === NodeRelation.Input ? tensor.producers : tensor.consumers) ?? [];
                if (counterparts.length === 0 || counterparts.some((id) => !memberIds.has(id))) {
                    seenIds.add(tensor.id);
                    tensors.push(withExternalEndpoints(tensor, memberIds, direction));
                }
            }
        }
    }
    return tensors;
};
