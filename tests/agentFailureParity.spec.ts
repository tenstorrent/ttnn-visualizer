// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getAllocationFailureDiagnosis, parseAllocationFailure } from '../src/functions/parseAllocationFailure';
import { getFailedDeviceOperationNames } from '../src/functions/scopeOutcomes';
import { getDramFallbacks } from '../src/functions/getDramFallbacks';
import {
    buildL1PeakDecomposition,
    getTopL1PeakOperations,
    resolveAddressLifetimes,
} from '../src/functions/l1PeakDecomposition';
import { processMemoryAllocations } from '../src/functions/processMemoryAllocations';
import { AllocationFailure } from '../src/model/AllocationFailure';
import { Buffer, Node, Operation, OperationDescription } from '../src/model/APIData';
import { L1PeakDecomposition } from '../src/model/L1PeakDecomposition';
import { OperationDetails } from '../src/model/OperationDetails';
import { CBPressureSnapshot } from '../src/model/MemoryAllocations';
import golden from './data/agentFailureParity.json';

// The agent's Python ports (#2154) wrote this golden, from test_agent_failure_parity.py; holding
// the app to it fails a change on either side. Regenerate with `pnpm run agent:parity-golden`.

const byKey = <V>(entries: [number, V][]) => [...entries].sort(([left], [right]) => left - right);
const indexedCases = <T>(cases: T[]) => cases.map((entry, index) => [index, entry] as const);

it('the golden covers every function the agent restates', () => {
    expect(golden.allocationFailures.length).toBeGreaterThan(0);
    expect(golden.failedDeviceOperations.length).toBeGreaterThan(0);
    expect(golden.dramFallbacks.length).toBeGreaterThan(0);
    expect(golden.addressLifetimes.length).toBeGreaterThan(0);
    expect(golden.l1Peak.length).toBeGreaterThan(0);
    expect(golden.topOperations.length).toBeGreaterThan(0);
    expect(golden.circularBuffers.length).toBeGreaterThan(0);
    expect(golden.deviceOperationOrder.length).toBeGreaterThan(0);
});

describe('parseAllocationFailure and its diagnosis', () => {
    it.each(indexedCases(golden.allocationFailures))(
        'case %i matches the agent',
        (_, { message, failure, reason, phrases }) => {
            const parsed = parseAllocationFailure({ id: 1, name: 'op', error: { error_message: message } } as Pick<
                Operation,
                'id' | 'name' | 'error'
            >);

            expect(parsed).toEqual(failure === null ? null : { ...failure, operationId: 1, operationName: 'op' });
            const diagnosis = parsed ? getAllocationFailureDiagnosis(parsed) : null;
            expect(diagnosis?.reason ?? null).toBe(reason);
            expect(
                diagnosis ? golden.detailPhrases.filter((phrase) => diagnosis.detail.includes(phrase)) : null,
            ).toEqual(phrases);
        },
    );
});

describe('getFailedDeviceOperationNames', () => {
    it.each(indexedCases(golden.failedDeviceOperations))('case %i matches the agent', (_, { nodes, failed }) => {
        expect(getFailedDeviceOperationNames(nodes as unknown as Node[])).toEqual(failed);
    });
});

describe('getDramFallbacks', () => {
    it.each(indexedCases(golden.dramFallbacks))('case %i matches the agent', (_, { operations, fallbacks }) => {
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
    });
});

describe('resolveAddressLifetimes', () => {
    it.each(indexedCases(golden.addressLifetimes))(
        'case %i matches the agent',
        (_, { operations, lastUseByAddress, unattributableStaleAddressCount }) => {
            const lifetimes = resolveAddressLifetimes(operations as unknown as OperationDescription[]);

            expect(byKey([...lifetimes.lastUseByAddress.entries()])).toEqual(lastUseByAddress);
            expect(lifetimes.unattributableStaleAddressCount).toBe(unattributableStaleAddressCount);
        },
    );
});

describe('buildL1PeakDecomposition', () => {
    it.each(indexedCases(golden.l1Peak))(
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
    it.each(indexedCases(golden.topOperations))('case %i matches the agent', (_, { entries, count, top }) => {
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
    });
});

describe('processMemoryAllocations circular-buffer snapshots', () => {
    // The port keeps no `nodeId` or expanded `cores`; `numCores` and `coreRangeSet` pin the
    // latter. An absent id or name is `undefined` here and `null` in JSON.
    const projected = ({ byCore, maxBytes, unattributedBytes, allocations }: CBPressureSnapshot) => ({
        byCore,
        maxBytes,
        unattributedBytes,
        allocations: allocations.map((allocation) => ({
            address: allocation.address,
            size: allocation.size,
            numCores: allocation.numCores,
            coreRangeSet: allocation.coreRangeSet ?? null,
            allocateOperationId: allocation.allocateOperationId ?? null,
            allocateOperationName: allocation.allocateOperationName ?? null,
            globallyAllocated: allocation.globallyAllocated,
            deviceCount: allocation.deviceCount,
        })),
    });

    it.each(indexedCases(golden.circularBuffers))('case %i matches the agent', (_, { nodes, snapshots }) => {
        // Cloned because it writes the allocating operation onto each node's params.
        const { cbPressureByOpId } = processMemoryAllocations(structuredClone(nodes) as Node[]);

        expect([...cbPressureByOpId.entries()].map(([opId, snapshot]) => [opId, projected(snapshot)])).toEqual(
            snapshots,
        );
    });
});

describe('OperationDetails.sortDeviceOperationsByBufferDeallocation', () => {
    // The order the modal hands processMemoryAllocations, as positions in the input; a
    // free-all the sort repeats appears more than once.
    it.each(indexedCases(golden.deviceOperationOrder))('case %i matches the agent', (_, { nodes, order }) => {
        const input = structuredClone(nodes) as Node[];
        const sorted = OperationDetails.prototype.sortDeviceOperationsByBufferDeallocation(input);

        expect(sorted.map((node) => input.indexOf(node))).toEqual(order);
    });
});
