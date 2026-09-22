// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { buildL1PeakDecomposition } from '../functions/l1PeakDecomposition';
import { NO_CONSUMER_OPERATION_ID, getLastValidConsumer } from '../functions/lateDeallocation';
import { L1PeakStatus } from '../definitions/L1PeakDecomposition';
import { L1PeakDecompositionState } from '../model/L1PeakDecomposition';
import { Buffer, OperationDescription, Tensor } from '../model/APIData';
import { BufferType } from '../model/BufferType';
import { activeProfilerReportAtom } from '../store/app';
import { useBuffers, useDevices, useOperationsList } from './useAPI';

const L1_TENSOR_TYPES: ReadonlySet<BufferType> = new Set([BufferType.L1, BufferType.L1_SMALL]);

interface AddressLifetimes {
    lastUseByAddress: Map<number, number>;
    unattributableStaleAddressCount: number;
}

/**
 * Last real use per address, for the addresses where that question has one answer.
 *
 * An address outlives the tensor that used it — resnet50 reuses 1,413,632 across 40 tensors —
 * so for a shared address there is no way to say which lifetime the resident belongs to.
 * Collapsing them (this previously took the maximum) does not hide the problem, it picks a
 * side: the maximum silently reclassifies genuinely stale residents as persistent, masking
 * 478 operation-slots on resnet50 against the 9 it reports. Leaving a shared address
 * unclassified makes the stale figure a floor instead, which is a claim the data supports.
 * #2029
 */
const resolveAddressLifetimes = (operations: readonly OperationDescription[]): AddressLifetimes => {
    const operationNamesById = new Map<number, string>(operations.map((operation) => [operation.id, operation.name]));
    const lastUseByTensorId = new Map<number, { address: number; lastUse: number }>();

    const consider = (tensor: Tensor) => {
        if (tensor.address === null || tensor.buffer_type === null || !L1_TENSOR_TYPES.has(tensor.buffer_type)) {
            return;
        }
        // Same definition of "a real use" as the late-deallocation overlay, so the two views
        // cannot disagree about what counts as a use — only, per the above, about attribution.
        const { lastConsumerOperationId } = getLastValidConsumer(tensor.consumers, operationNamesById);

        lastUseByTensorId.set(tensor.id, { address: tensor.address, lastUse: lastConsumerOperationId });
    };

    operations.forEach((operation) => {
        operation.inputs?.forEach(consider);
        operation.outputs?.forEach(consider);
    });

    const byAddress = new Map<number, number[]>();

    lastUseByTensorId.forEach(({ address, lastUse }) => {
        const existing = byAddress.get(address);

        if (existing) {
            existing.push(lastUse);
        } else {
            byAddress.set(address, [lastUse]);
        }
    });

    const lastUseByAddress = new Map<number, number>();
    let unattributableStaleAddressCount = 0;

    byAddress.forEach((lastUses, address) => {
        // A tensor whose only consumers are deallocate calls has no last use to be late
        // relative to, and contributes no lifetime rather than an early one.
        const real = lastUses.filter((lastUse) => lastUse > NO_CONSUMER_OPERATION_ID);

        if (real.length === 1) {
            lastUseByAddress.set(address, real[0]);
        } else if (real.length > 1) {
            unattributableStaleAddressCount += 1;
        }
    });

    return { lastUseByAddress, unattributableStaleAddressCount };
};

/**
 * Replays the run's captured graphs into a per-operation L1 peak decomposition.
 *
 * Reuses queries the app already runs: `/api/operations` carries each operation's
 * `device_operations` and its tensors, and the snapshot comes from the buffer queries Buffer
 * Summary uses.
 */
export const useL1PeakDecomposition = (): L1PeakDecompositionState => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const operationsQuery = useOperationsList();
    const l1Query = useBuffers(BufferType.L1, false);
    const l1SmallQuery = useBuffers(BufferType.L1_SMALL, false);
    // In the gate because the bank count and the L1 budget both come from here: without it the
    // first pass runs at the default 64 banks on a 120-bank part, and — worse — with no budget,
    // which switches the "not usable" refusal off rather than on.
    const devicesQuery = useDevices();

    const isError = operationsQuery.isError || l1Query.isError || l1SmallQuery.isError || devicesQuery.isError;
    const isLoading =
        operationsQuery.isLoading || l1Query.isLoading || l1SmallQuery.isLoading || devicesQuery.isLoading;

    const snapshotByOperationId = useMemo(() => {
        // L1_SMALL occupies L1 and the replay counts it, so the snapshot it reconciles against
        // must too, or every L1_SMALL allocation is dropped at each operation boundary.
        const byOperation = new Map<number, Buffer[]>();

        [l1Query.data ?? [], l1SmallQuery.data ?? []].forEach((set) => {
            set.forEach(({ id, buffers }) => {
                const existing = byOperation.get(id);

                if (existing) {
                    existing.push(...buffers);
                } else {
                    byOperation.set(id, [...buffers]);
                }
            });
        });

        return byOperation;
    }, [l1Query.data, l1SmallQuery.data]);

    const lifetimes = useMemo(() => resolveAddressLifetimes(operationsQuery.data ?? []), [operationsQuery.data]);

    return useMemo(() => {
        const empty = { data: null, unattributableStaleAddressCount: 0 };

        if (activeProfilerReport === null) {
            return { status: L1PeakStatus.Unavailable, ...empty };
        }
        if (isError) {
            return { status: L1PeakStatus.Error, ...empty };
        }
        if (isLoading || !operationsQuery.data || !devicesQuery.data) {
            return { status: L1PeakStatus.Loading, ...empty };
        }

        // A report with no `devices` row cannot be judged against a budget, and the engine says
        // so via a null capacity rather than reporting every figure as plausible.
        const device = devicesQuery.data[0];

        return {
            status: L1PeakStatus.Ready,
            data: buildL1PeakDecomposition({
                operations: operationsQuery.data,
                snapshotByOperationId,
                lastUseByAddress: lifetimes.lastUseByAddress,
                bankCount: device?.l1_num_banks,
                capacityBytes: device?.worker_l1_size,
            }),
            unattributableStaleAddressCount: lifetimes.unattributableStaleAddressCount,
        };
    }, [
        activeProfilerReport,
        isError,
        isLoading,
        operationsQuery.data,
        devicesQuery.data,
        snapshotByOperationId,
        lifetimes,
    ]);
};
