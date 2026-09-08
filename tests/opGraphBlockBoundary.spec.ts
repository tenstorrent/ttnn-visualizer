// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getBlockBoundaryTensors, withExternalEndpoints } from '../src/components/operation-graph/opGraphBlockBoundary';
import { NodeRelation } from '../src/definitions/NodeRelation';
import type { OperationDescription, Tensor } from '../src/model/APIData';

const tensor = (overrides: Partial<Tensor> & { id: number }): Tensor =>
    ({ shape: '[1, 32]', size: 128, ...overrides }) as unknown as Tensor;

const member = (id: number, inputs: Tensor[], outputs: Tensor[]): OperationDescription =>
    ({ id, name: `op_${id}`, inputs, outputs }) as unknown as OperationDescription;

const MEMBERS = new Set([10, 11]);

describe('withExternalEndpoints', () => {
    it('keeps ids and names aligned when it drops an interior producer', () => {
        // The pair is filtered together; filtering ids alone would shift every
        // name by one and credit the tensor to the wrong operation.
        const result = withExternalEndpoints(
            tensor({ id: 1, producers: [10, 7, 11, 8], producerNames: ['m_a', 'outside_x', 'm_b', 'outside_y'] }),
            MEMBERS,
            NodeRelation.Input,
        );

        expect(result.producers).toEqual([7, 8]);
        expect(result.producerNames).toEqual(['outside_x', 'outside_y']);
    });

    it('keeps ids and names aligned on the consumer side too', () => {
        const result = withExternalEndpoints(
            tensor({ id: 2, consumers: [10, 9, 11], consumerNames: ['m_a', 'outside_z', 'm_b'] }),
            MEMBERS,
            NodeRelation.Output,
        );

        expect(result.consumers).toEqual([9]);
        expect(result.consumerNames).toEqual(['outside_z']);
    });

    it('substitutes an empty name rather than dropping an unnamed endpoint', () => {
        // A short names array must not shorten the id list, or the two stop
        // corresponding for every entry after the gap.
        const result = withExternalEndpoints(
            tensor({ id: 3, producers: [7, 8], producerNames: ['outside_x'] }),
            MEMBERS,
            NodeRelation.Input,
        );

        expect(result.producers).toEqual([7, 8]);
        expect(result.producerNames).toEqual(['outside_x', '']);
    });

    it('tolerates a tensor with no endpoint arrays at all', () => {
        const result = withExternalEndpoints(tensor({ id: 4 }), MEMBERS, NodeRelation.Input);

        expect(result.producers).toEqual([]);
        expect(result.producerNames).toEqual([]);
    });

    it('leaves the source tensor untouched', () => {
        const source = tensor({ id: 5, producers: [10, 7], producerNames: ['m_a', 'outside_x'] });

        withExternalEndpoints(source, MEMBERS, NodeRelation.Input);

        expect(source.producers).toEqual([10, 7]);
    });
});

describe('getBlockBoundaryTensors', () => {
    it('drops a tensor whose every producer is inside the block', () => {
        const internal = tensor({ id: 100, producers: [10], producerNames: ['m_a'] });
        const crossing = tensor({ id: 101, producers: [7], producerNames: ['outside_x'] });

        const result = getBlockBoundaryTensors(
            [member(10, [internal], []), member(11, [crossing], [])],
            MEMBERS,
            NodeRelation.Input,
        );

        expect(result.map((entry) => entry.id)).toEqual([101]);
    });

    it('keeps a tensor with no producers at all as a graph input', () => {
        const result = getBlockBoundaryTensors(
            [member(10, [tensor({ id: 102, producers: [] })], [])],
            MEMBERS,
            NodeRelation.Input,
        );

        expect(result.map((entry) => entry.id)).toEqual([102]);
    });

    it('deduplicates a tensor two members both consume', () => {
        const shared = tensor({ id: 103, producers: [7], producerNames: ['outside_x'] });

        const result = getBlockBoundaryTensors(
            [member(10, [shared], []), member(11, [shared], [])],
            MEMBERS,
            NodeRelation.Input,
        );

        expect(result).toHaveLength(1);
    });

    it('narrows the endpoints of what it keeps', () => {
        const crossing = tensor({ id: 104, consumers: [10, 9], consumerNames: ['m_a', 'outside_z'] });

        const result = getBlockBoundaryTensors([member(10, [], [crossing])], MEMBERS, NodeRelation.Output);

        expect(result[0].consumers).toEqual([9]);
        expect(result[0].consumerNames).toEqual(['outside_z']);
    });

    it('reads outputs rather than inputs in the output direction', () => {
        const asInput = tensor({ id: 105, producers: [7], producerNames: ['outside_x'] });
        const asOutput = tensor({ id: 106, consumers: [9], consumerNames: ['outside_z'] });

        const result = getBlockBoundaryTensors([member(10, [asInput], [asOutput])], MEMBERS, NodeRelation.Output);

        expect(result.map((entry) => entry.id)).toEqual([106]);
    });
});
