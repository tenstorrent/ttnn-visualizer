// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useL1PeakDecomposition } from '../src/hooks/useL1PeakDecomposition';
import { useBuffers, useDevices, useOperationsList } from '../src/hooks/useAPI';
import { L1PeakStatus, L1ResidentKind } from '../src/definitions/L1PeakDecomposition';
import { BufferType } from '../src/model/BufferType';
import { activeProfilerReportAtom } from '../src/store/app';
import { AtomProvider } from './helpers/atomProvider';

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: vi.fn(),
    useBuffers: vi.fn(),
    useDevices: vi.fn(),
}));

const settled = <T,>(data: T) => ({ data, isLoading: false, isError: false });
const loading = { data: undefined, isLoading: true, isError: false };
const errored = { data: undefined, isLoading: false, isError: true };

const tensor = (id: number, address: number | null, consumers: number[], bufferType = BufferType.L1) => ({
    id,
    address,
    consumers,
    buffer_type: bufferType,
});

const operation = (id: number, name: string, nodes: unknown[] = [], inputs: unknown[] = [], outputs: unknown[] = []) =>
    ({ id, name, device_operations: nodes, inputs, outputs }) as never;

/** No `max_size_per_bank`, so the engine must fall back to `size / num_cores`. */
const allocateWithoutPerBank = (address: number, size: number) =>
    ({
        node_type: 'buffer_allocate',
        id: 0,
        connections: [],
        inputs: [],
        outputs: [],
        stacking_level: 1,
        params: {
            address: String(address),
            size: String(size),
            num_cores: '0',
            type: 'L1',
            buffer_type: BufferType.L1,
        },
    }) as never;

const allocateSmall = (address: number, maxSizePerBank: number) =>
    ({
        node_type: 'buffer_allocate',
        id: 0,
        connections: [],
        inputs: [],
        outputs: [],
        stacking_level: 1,
        params: {
            address: String(address),
            size: String(maxSizePerBank * 64),
            num_cores: '64',
            type: 'L1',
            buffer_type: BufferType.L1_SMALL,
            max_size_per_bank: String(maxSizePerBank),
        },
    }) as never;

const allocate = (address: number, maxSizePerBank: number) =>
    ({
        node_type: 'buffer_allocate',
        id: 0,
        connections: [],
        inputs: [],
        outputs: [],
        stacking_level: 1,
        params: {
            address: String(address),
            size: String(maxSizePerBank * 64),
            num_cores: '64',
            type: 'L1',
            buffer_type: BufferType.L1,
            max_size_per_bank: String(maxSizePerBank),
        },
    }) as never;

interface MockOptions {
    operations?: unknown;
    l1?: unknown;
    l1Small?: unknown;
    devices?: unknown;
}

const mockQueries = ({ operations: ops, l1, l1Small, devices }: MockOptions) => {
    vi.mocked(useOperationsList).mockReturnValue((ops ?? settled([])) as never);
    vi.mocked(useBuffers).mockImplementation(((bufferType: BufferType) =>
        bufferType === BufferType.L1_SMALL ? (l1Small ?? settled([])) : (l1 ?? settled([]))) as never);
    vi.mocked(useDevices).mockReturnValue(
        (devices ?? settled([{ l1_num_banks: 64, worker_l1_size: 1_000_000 }])) as never,
    );
};

const render = (hasReport = true) =>
    renderHook(() => useL1PeakDecomposition(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
            <AtomProvider initialValues={[[activeProfilerReportAtom, hasReport ? ({ path: 'r' } as never) : null]]}>
                {children}
            </AtomProvider>
        ),
    });

describe('useL1PeakDecomposition', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reports Unavailable when no report is selected', () => {
        mockQueries({});
        expect(render(false).result.current.status).toBe(L1PeakStatus.UNAVAILABLE);
    });

    it('reports Loading until every query it reads has settled', () => {
        mockQueries({ operations: loading });
        expect(render().result.current.status).toBe(L1PeakStatus.LOADING);
    });

    it('waits for devices, rather than replaying at the default bank count without a budget', () => {
        // Omitting devices from the gate let the first pass run at 64 banks on a 120-bank part
        // AND with no capacity, which switched the "not usable" refusal off instead of on:
        // visualizer_db rendered 309 MiB as a headline figure with no warning.
        mockQueries({ operations: settled([operation(1, 'op')]), devices: loading });

        expect(render().result.current.status).toBe(L1PeakStatus.LOADING);
        expect(render().result.current.data).toBeNull();
    });

    it('does not build while devices is refetching, even though stale data is present', () => {
        mockQueries({
            operations: settled([operation(1, 'op', [allocate(1000, 400)])]),
            devices: { data: [{ l1_num_banks: 64, worker_l1_size: 1000 }], isLoading: true, isError: false },
        });

        expect(render().result.current.status).toBe(L1PeakStatus.LOADING);
    });

    it('reports Error when devices settles empty, which leaves no budget to judge against', () => {
        // The value that matters: `fetchDevices` resolves to [] with only a toast when a report
        // has no devices row, and an empty array is truthy, so the `!devicesQuery.data` gate does
        // not catch it. Building anyway yields capacityBytes null and exceedsCapacity false — the
        // refusal fails open at exactly the moment the figures are least trustworthy. Asserting
        // LOADING against `data: undefined` pinned the gate above instead and left this uncovered.
        mockQueries({
            operations: settled([operation(1, 'op', [allocate(1000, 400)])]),
            devices: settled([]),
        });

        const { status, data } = render().result.current;

        expect(status).toBe(L1PeakStatus.ERROR);
        expect(data).toBeNull();
    });

    it('does not build when devices settles undefined, which would dereference nothing', () => {
        mockQueries({
            operations: settled([operation(1, 'op', [allocate(1000, 400)])]),
            devices: { data: undefined, isLoading: false, isError: false },
        });

        expect(render().result.current.status).toBe(L1PeakStatus.LOADING);
    });

    it('reports Error rather than an empty decomposition when a query fails', () => {
        // useBuffers throws ERR_INVALID_RESPONSE on payloads it declines to render. React Query
        // reports that as settled-with-undefined, so reading only `data` turned a fetch failure
        // into a silent graph-only replay: sentence_bert's peak rose 24% and still read as fact.
        mockQueries({ operations: settled([operation(1, 'op')]), l1: errored });

        const { status, data } = render().result.current;

        expect(status).toBe(L1PeakStatus.ERROR);
        expect(data).toBeNull();
    });

    it('merges L1 and L1_SMALL snapshots for the same operation instead of overwriting', () => {
        // Without the L1_SMALL half, the snapshot holds only 1000 and the L1_SMALL allocation is
        // reconciled away at the boundary as though it had been freed.
        mockQueries({
            operations: settled([
                operation(1, 'op', [allocate(1000, 400), allocateSmall(2000, 64)]),
                operation(2, 'next'),
            ]),
            l1: settled([{ id: 1, buffers: [{ address: 1000, size: 400, buffer_type: BufferType.L1, device_id: 0 }] }]),
            l1Small: settled([
                { id: 1, buffers: [{ address: 2000, size: 64, buffer_type: BufferType.L1_SMALL, device_id: 0 }] },
            ]),
        });

        const { data } = render().result.current;

        expect(data?.byOperationId.get(1)?.reconciledAwayCount).toBe(0);
        expect(data?.byOperationId.get(2)?.totalBytes).toBe(464);
    });

    it('treats a tensor with no real consumer as contributing no lifetime', () => {
        // One real lifetime plus a consumer-less duplicate at the same address still has one
        // answer; counting the sentinel as a lifetime would make the address unattributable.
        mockQueries({
            operations: settled([
                operation(1, 'op', [allocate(1000, 400)], [tensor(10, 1000, [2]), tensor(11, 1000, [])]),
                operation(5, 'later', [allocate(3000, 100)]),
            ]),
        });

        const { data, unattributableStaleAddressCount } = render().result.current;

        expect(unattributableStaleAddressCount).toBe(0);
        expect(data?.byOperationId.get(5)?.staleTensorBytes).toBe(400);
    });

    it('resolves lifetimes from operation outputs as well as inputs', () => {
        mockQueries({
            operations: settled([
                operation(1, 'op', [allocate(1000, 400)], [], [tensor(10, 1000, [2])]),
                operation(5, 'later', [allocate(3000, 100)]),
            ]),
        });

        expect(render().result.current.data?.byOperationId.get(5)?.staleTensorBytes).toBe(400);
    });

    it('uses the device bank count for the per-bank fallback', () => {
        mockQueries({
            operations: settled([operation(1, 'op', [allocateWithoutPerBank(1000, 12_000)])]),
            devices: settled([{ l1_num_banks: 120, worker_l1_size: 1_000_000 }]),
        });

        expect(render().result.current.data?.peak?.totalBytes).toBe(100);
    });

    it('leaves a recycled address unclassified rather than guessing which tensor is resident', () => {
        // resnet50 reuses 1,413,632 across 40 tensors. Taking the maximum last use silently
        // reclassified genuinely stale residents as persistent — 478 masked operation-slots
        // against the 9 it reported. An address with one lifetime is still attributed. #2029
        mockQueries({
            operations: settled([
                operation(
                    1,
                    'op',
                    [allocate(1000, 400), allocate(2000, 300)],
                    [tensor(10, 1000, [2]), tensor(11, 1000, [8]), tensor(12, 2000, [2])],
                ),
                operation(5, 'later', [allocate(3000, 100)]),
            ]),
        });

        const fifth = render().result.current;

        expect(fifth.unattributableStaleAddressCount).toBe(1);
        // 2000 has a single lifetime ending at op 2, so it is stale by op 5; 1000 is shared and
        // contributes nothing to the stale total.
        expect(fifth.data?.byOperationId.get(5)?.staleTensorBytes).toBe(300);
        expect(fifth.data?.byOperationId.get(5)?.persistentTensorBytes).toBe(500);
    });

    it('ignores DRAM tensors when resolving L1 last use', () => {
        mockQueries({
            operations: settled([
                operation(1, 'op', [allocate(1000, 400)], [tensor(10, 1000, [2], BufferType.DRAM)]),
                operation(5, 'later', [allocate(3000, 100)]),
            ]),
        });

        // The DRAM tensor at the same numeric address must not make the L1 resident stale.
        expect(render().result.current.data?.byOperationId.get(5)?.staleTensorBytes).toBe(0);
    });

    it('passes the device bank count and budget through to the engine', () => {
        mockQueries({
            operations: settled([operation(1, 'op', [allocate(1000, 400)])]),
            devices: settled([{ l1_num_banks: 120, worker_l1_size: 300 }]),
        });

        const { data } = render().result.current;

        expect(data?.capacityBytes).toBe(300);
        expect(data?.exceedsCapacity).toBe(true);
    });

    it('names contributors so a peak can be attributed', () => {
        mockQueries({ operations: settled([operation(1, 'op', [allocate(1000, 400)])]) });

        expect(render().result.current.data?.peak?.contributors[0]).toMatchObject({
            address: 1000,
            bytes: 400,
            kind: L1ResidentKind.PERSISTENT_TENSOR,
        });
    });
});
