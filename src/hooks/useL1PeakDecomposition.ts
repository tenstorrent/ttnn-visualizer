// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { L1PeakDecompositionResult, buildL1PeakDecomposition } from '../functions/l1PeakDecomposition';
import { getLastValidConsumer } from '../functions/lateDeallocation';
import { BufferType } from '../model/BufferType';
import { Buffer } from '../model/APIData';
import { useBuffers, useDevices, useOperationsList, useTensors } from './useAPI';

const EMPTY_RESULT: L1PeakDecompositionResult = {
    byOperationId: new Map(),
    peak: null,
    reconciledAwayCount: 0,
    capacityBytes: null,
    exceedsCapacity: false,
};

/**
 * Replays the run's captured graphs into a per-operation L1 peak decomposition.
 *
 * Everything it needs is already fetched for other views: `/api/operations` carries each
 * operation's `device_operations`, and the post-op snapshot comes from the buffer queries
 * that Buffer Summary uses. Nothing new is requested.
 */
export const useL1PeakDecomposition = (): { result: L1PeakDecompositionResult; isLoading: boolean } => {
    const { data: operations, isLoading: operationsLoading } = useOperationsList();
    const { data: l1Buffers, isLoading: l1Loading } = useBuffers(BufferType.L1, false);
    const { data: l1SmallBuffers, isLoading: l1SmallLoading } = useBuffers(BufferType.L1_SMALL, false);
    const { data: tensors, isLoading: tensorsLoading } = useTensors();
    const { data: devices } = useDevices();

    const isLoading = operationsLoading || l1Loading || l1SmallLoading || tensorsLoading;

    const snapshotByOperationId = useMemo(() => {
        // L1_SMALL occupies L1 too, and the replay counts it, so the snapshot it reconciles
        // against has to as well or every L1_SMALL allocation is dropped at each boundary.
        const byOperation = new Map<number, Buffer[]>();

        [l1Buffers ?? [], l1SmallBuffers ?? []].forEach((set) => {
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
    }, [l1Buffers, l1SmallBuffers]);

    const lastUseByAddress = useMemo(() => {
        const operationNamesById = new Map<number, string>((operations ?? []).map((op) => [op.id, op.name]));
        const byAddress = new Map<number, number>();

        (tensors ?? []).forEach((tensor) => {
            if (tensor.address === null) {
                return;
            }
            // Same definition of "a real use" as the Buffer Summary overlay, so the advisor
            // and the hatching cannot disagree about which tensors are stale.
            const { lastConsumerOperationId } = getLastValidConsumer(tensor.consumers, operationNamesById);
            const previous = byAddress.get(tensor.address);

            // An address outlives the tensor that used it, so this collapses several
            // lifetimes into one entry. Staleness is indicative only. #2029
            byAddress.set(
                tensor.address,
                previous === undefined ? lastConsumerOperationId : Math.max(previous, lastConsumerOperationId),
            );
        });

        return byAddress;
    }, [tensors, operations]);

    return useMemo(() => {
        if (isLoading || !operations) {
            return { result: EMPTY_RESULT, isLoading };
        }

        return {
            result: buildL1PeakDecomposition({
                operations,
                snapshotByOperationId,
                lastUseByAddress,
                bankCount: devices?.[0]?.l1_num_banks,
                capacityBytes: devices?.[0]?.worker_l1_size,
            }),
            isLoading: false,
        };
    }, [isLoading, operations, snapshotByOperationId, lastUseByAddress, devices]);
};
