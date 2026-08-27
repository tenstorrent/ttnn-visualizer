// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

import { getAdjacentOperationIds } from '../src/components/operation-graph/opGraphNavigation';
import type { OpGraphNodeIndexEntry } from '../src/components/operation-graph/opGraphTypes';

const entry = (operationId: number, memberOperationIds?: number[]): OpGraphNodeIndexEntry => ({
    id: memberOperationIds ? `block:0:${operationId}` : String(operationId),
    operationId,
    name: `op ${operationId}`,
    memberOperationIds,
});

describe('getAdjacentOperationIds', () => {
    it('steps either side of a plain operation', () => {
        const nodeIndex = [entry(1), entry(2), entry(3)];

        expect(getAdjacentOperationIds(nodeIndex, 2)).toEqual({ previousOperationId: 1, nextOperationId: 3 });
    });

    it('returns null past each end rather than wrapping', () => {
        const nodeIndex = [entry(1), entry(2)];

        expect(getAdjacentOperationIds(nodeIndex, 1).previousOperationId).toBeNull();
        expect(getAdjacentOperationIds(nodeIndex, 2).nextOperationId).toBeNull();
    });

    it('finds a folded block by a member that is not its representative (#1944)', () => {
        // Selecting op 3 and folding [2, 3] keeps the selection on 3, but the
        // block indexes under 2 — an exact-id lookup missed it and `next` jumped
        // back to the graph's first node.
        const nodeIndex = [entry(1), entry(2, [2, 3]), entry(4)];

        expect(getAdjacentOperationIds(nodeIndex, 3)).toEqual({ previousOperationId: 1, nextOperationId: 4 });
    });

    it('treats the block representative and its members alike', () => {
        const nodeIndex = [entry(1), entry(2, [2, 3, 4]), entry(5)];

        expect(getAdjacentOperationIds(nodeIndex, 2)).toEqual(getAdjacentOperationIds(nodeIndex, 4));
    });

    it('offers the first node when the selection is absent or empty', () => {
        const nodeIndex = [entry(7), entry(8)];

        expect(getAdjacentOperationIds(nodeIndex, 99)).toEqual({ previousOperationId: null, nextOperationId: 7 });
        expect(getAdjacentOperationIds(nodeIndex, null)).toEqual({ previousOperationId: null, nextOperationId: 7 });
        expect(getAdjacentOperationIds([], 1)).toEqual({ previousOperationId: null, nextOperationId: null });
    });
});
