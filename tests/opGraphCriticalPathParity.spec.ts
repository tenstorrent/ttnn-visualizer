// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getKeptOperations } from '../src/components/operation-graph/opGraphBuilder';
import { findCriticalPath } from '../src/components/operation-graph/opGraphCriticalPath';
import type { OpGraphSourceOperation } from '../src/components/operation-graph/opGraphTypes';
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

interface KeptCase {
    name: string;
    operations: [operationId: number, name: string][];
    edges: [source: number, target: number, tensorId: number][];
    expected_kept: number[];
}

const US_TO_NS = 1000;

// One output per produced tensor, listing every operation that consumed it.
const toSourceOperations = ({ operations, edges }: KeptCase): OpGraphSourceOperation[] =>
    operations.map(([id, name]) => {
        const consumersByTensorId = new Map<number, number[]>();
        for (const [source, target, tensorId] of edges) {
            if (source === id) {
                consumersByTensorId.set(tensorId, [...(consumersByTensorId.get(tensorId) ?? []), target]);
            }
        }
        return {
            id,
            name,
            fileIdentifier: '',
            deviceOperationCount: 0,
            outputs: [...consumersByTensorId].map(([tensorId, consumers]) => ({
                tensorId,
                consumers,
                edgeLabel: '',
            })),
        };
    });

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

describe('getKeptOperations', () => {
    it.each((golden.kept_cases as KeptCase[]).map((entry) => [entry.name, entry] as const))(
        '%s matches the agent',
        (_, entry) => {
            const kept = getKeptOperations(toSourceOperations(entry), true).map((operation) => operation.id);

            expect(kept.sort((left, right) => left - right)).toEqual(entry.expected_kept);
        },
    );
});
