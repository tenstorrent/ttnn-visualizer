// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getAllocationFailureDiagnosis, parseAllocationFailure } from '../src/functions/parseAllocationFailure';
import { getFailedDeviceOperationNames } from '../src/functions/scopeOutcomes';
import { getDramFallbacks } from '../src/functions/getDramFallbacks';
import { buildL1PeakDecomposition, getTopL1PeakOperations } from '../src/functions/l1PeakDecomposition';
import { resolveAddressLifetimes } from '../src/hooks/useL1PeakDecomposition';
import { AllocationFailure } from '../src/model/AllocationFailure';
import { Buffer, Node, Operation, OperationDescription } from '../src/model/APIData';
import { L1PeakDecomposition } from '../src/model/L1PeakDecomposition';
import golden from './data/agentFailureParity.json';

// The agent's Python ports (#2154) wrote this golden, from test_agent_failure_parity.py; holding
// the app to it fails a change on either side. Regenerate with `pnpm run agent:parity-golden`.

const byKey = <V>(entries: [number, V][]) => [...entries].sort(([left], [right]) => left - right);

it('the golden covers every function the agent restates', () => {
    expect(golden.allocationFailures.length).toBeGreaterThan(0);
    expect(golden.failedDeviceOperations.length).toBeGreaterThan(0);
    expect(golden.dramFallbacks.length).toBeGreaterThan(0);
    expect(golden.addressLifetimes.length).toBeGreaterThan(0);
    expect(golden.l1Peak.length).toBeGreaterThan(0);
    expect(golden.topOperations.length).toBeGreaterThan(0);
});

describe('parseAllocationFailure and its diagnosis', () => {
    it.each(golden.allocationFailures.map((entry, index) => [index, entry] as const))(
        'case %i matches the agent',
        (_, { message, failure, reason, phrases }) => {
            const parsed = parseAllocationFailure({ id: 1, name: 'op', error: { error_message: message } } as Pick<
                Operation,
                'id' | 'name' | 'error'
            >);
            const { operationId, operationName, ...fields } = parsed ?? ({} as AllocationFailure);

            expect(parsed === null ? null : fields).toEqual(failure);
            expect(parsed && operationId).toBe(parsed && 1);
            expect(parsed && operationName).toBe(parsed && 'op');
            const diagnosis = parsed ? getAllocationFailureDiagnosis(parsed) : null;
            expect(diagnosis?.reason ?? null).toBe(reason);
            expect(
                diagnosis ? golden.detailPhrases.filter((phrase) => diagnosis.detail.includes(phrase)) : null,
            ).toEqual(phrases);
        },
    );
});

describe('getFailedDeviceOperationNames', () => {
    it.each(golden.failedDeviceOperations.map((entry, index) => [index, entry] as const))(
        'case %i matches the agent',
        (_, { nodes, failed }) => {
            expect(getFailedDeviceOperationNames(nodes as unknown as Node[])).toEqual(failed);
        },
    );
});

describe('getDramFallbacks', () => {
    it.each(golden.dramFallbacks.map((entry, index) => [index, entry] as const))(
        'case %i matches the agent',
        (_, { operations, fallbacks }) => {
            const typed = operations as unknown as (Operation & { arguments: { name: string; value: string }[] })[];
            const failures = new Map<number, AllocationFailure>();

            typed.forEach((operation) => {
                const failure = parseAllocationFailure(operation);

                if (failure) {
                    failures.set(operation.id, failure);
                }
            });

            expect(byKey([...getDramFallbacks(typed, failures).entries()])).toEqual(
                byKey(fallbacks as [number, unknown][]),
            );
        },
    );
});

describe('resolveAddressLifetimes', () => {
    it.each(golden.addressLifetimes.map((entry, index) => [index, entry] as const))(
        'case %i matches the agent',
        (_, { operations, lastUseByAddress, unattributableStaleAddressCount }) => {
            const lifetimes = resolveAddressLifetimes(operations as unknown as OperationDescription[]);

            expect(byKey([...lifetimes.lastUseByAddress.entries()])).toEqual(lastUseByAddress);
            expect(lifetimes.unattributableStaleAddressCount).toBe(unattributableStaleAddressCount);
        },
    );
});

describe('buildL1PeakDecomposition', () => {
    it.each(golden.l1Peak.map((entry, index) => [index, entry] as const))(
        'case %i matches the agent',
        (_, { operations, snapshot, lastUseByAddress, bankCount, capacityBytes, result }) => {
            const built = buildL1PeakDecomposition({
                operations: operations as unknown as { id: number; device_operations: Node[] }[],
                snapshotByOperationId: new Map(snapshot as unknown as [number, Buffer[]][]),
                lastUseByAddress: new Map(lastUseByAddress as [number, number][]),
                bankCount: bankCount ?? undefined,
                capacityBytes: capacityBytes ?? undefined,
            });

            expect([...built.byOperationId.entries()]).toEqual(result.byOperationId);
            expect(built.peak?.operationId ?? null).toBe(result.peakOperationId);
            expect(built.reconciledAwayCount).toBe(result.reconciledAwayCount);
            expect(built.capacityBytes).toBe(result.capacityBytes);
            expect(built.exceedsCapacity).toBe(result.exceedsCapacity);
        },
    );
});

describe('getTopL1PeakOperations', () => {
    it.each(golden.topOperations.map((entry, index) => [index, entry] as const))(
        'case %i matches the agent',
        (_, { entries, count, top }) => {
            // The golden carries NaN and Infinity as the strings `Number()` reads.
            const decompositions = (entries as (number | string)[][]).map((fields) => {
                const [
                    operationId,
                    totalBytes,
                    circularBufferBytes,
                    intermediateTensorBytes,
                    persistentTensorBytes,
                    staleTensorBytes,
                ] = fields.map(Number);

                return {
                    operationId,
                    totalBytes,
                    circularBufferBytes,
                    intermediateTensorBytes,
                    persistentTensorBytes,
                    staleTensorBytes,
                } as L1PeakDecomposition;
            });

            expect(
                getTopL1PeakOperations(decompositions, count).map(({ entry, alsoAt }) => [entry.operationId, alsoAt]),
            ).toEqual(top);
        },
    );
});
