// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { findCriticalPath } from '../src/components/operation-graph/opGraphCriticalPath';
import golden from './data/opGraphCriticalPathParity.json';

// The agent's Python port (#2174) wrote this golden, from test_agent_critical_path_parity.py; holding
// the app to it fails a change on either side. Regenerate with `pnpm run agent:parity-golden`.

interface ParityCase {
    name: string;
    operation_ids: number[];
    edges: [source: number, target: number][];
    // Microseconds, as the agent reads device time.
    weights: [operationId: number, deviceTime: number][];
    expected: {
        operation_ids: number[];
        total: number;
        has_cycle: boolean;
    };
}

const US_TO_NS = 1000;

it('the golden holds cases', () => {
    expect(golden.cases.length).toBeGreaterThan(0);
});

describe('findCriticalPath', () => {
    it.each((golden.cases as ParityCase[]).map((entry) => [entry.name, entry] as const))(
        '%s matches the agent',
        (_, { operation_ids: operationIds, edges, weights, expected }) => {
            const path = findCriticalPath(
                operationIds.map((operationId) => ({ id: String(operationId), operationId })),
                edges.map(([source, target], index) => ({
                    id: `${source}-${target}-${index}`,
                    source: String(source),
                    target: String(target),
                })),
                new Map<number, number>(
                    weights.map(([operationId, deviceTime]) => [operationId, deviceTime * US_TO_NS]),
                ),
            );

            expect(path.opIds).toEqual(expected.operation_ids);
            expect(path.totalNs / US_TO_NS).toBeCloseTo(expected.total, 9);
            expect(path.hasCycle).toBe(expected.has_cycle);
        },
    );
});
