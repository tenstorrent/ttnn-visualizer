// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { buildL1PeakDecomposition, resolveAddressLifetimes } from '../functions/l1PeakDecomposition';
import { L1PeakStatus } from '../definitions/L1PeakDecomposition';
import { L1PeakDecompositionState } from '../model/L1PeakDecomposition';
import { Buffer } from '../model/APIData';
import { BufferType } from '../model/BufferType';
import { activeProfilerReportAtom } from '../store/app';
import { useBuffers, useDevices, useOperationsList } from './useAPI';

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
            return { status: L1PeakStatus.UNAVAILABLE, ...empty };
        }
        if (isError) {
            return { status: L1PeakStatus.ERROR, ...empty };
        }
        if (isLoading || !operationsQuery.data || !devicesQuery.data) {
            return { status: L1PeakStatus.LOADING, ...empty };
        }

        // `fetchDevices` returns [] with only a toast when a report has no devices row, and an
        // empty array is truthy — the guard above does not catch it. Without a device there is
        // no bank count and no budget, so the plausibility refusal would be switched off
        // exactly when the figures are least trustworthy.
        const device = devicesQuery.data[0];

        if (device === undefined) {
            return { status: L1PeakStatus.ERROR, ...empty };
        }

        return {
            status: L1PeakStatus.READY,
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
