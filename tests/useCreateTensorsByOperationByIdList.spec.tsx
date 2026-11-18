// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The hook builds the address map over every operation's buffers, then cuts it to the selected
 * range, so a buffer that left before the range still clears its address inside it. #2272
 */

import { act, cleanup, waitFor } from '@testing-library/react';
import { NumberRange } from '@blueprintjs/core';
import { createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateTensorsByOperationByIdList, useGetTensorDeallocationReportByOperation } from '../src/hooks/useAPI';
import { activeProfilerReportAtom, selectedOperationRangeAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { BufferType } from '../src/model/BufferType';
import { buildOperationDescription, buildTensor } from './helpers/operationDetailsFixtures';
import { renderHookWithStore } from './helpers/renderHookWithStore';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const TENSOR_ID = 10;
const ADDRESS = 100;

/**
 * Operation 1 outputs tensor 10 at address 100 and is its last use; operation `i + 1` records
 * `snapshots[i]`, and operation `deallocatedAt` deallocates the tensor.
 */
const mockReport = (snapshots: number[][], deallocatedAt?: number) =>
    vi.mocked(axiosInstance.get).mockImplementation((url) => {
        const operationIds = snapshots.map((_, index) => index + 1);

        if (String(url) === Endpoints.OPERATIONS_LIST) {
            const tensor = buildTensor({ id: TENSOR_ID, address: ADDRESS, consumers: [1] });

            return Promise.resolve({
                data: operationIds.map((id) =>
                    id === deallocatedAt
                        ? buildOperationDescription({ id, name: 'ttnn.deallocate', inputs: [tensor] })
                        : buildOperationDescription({ id, name: 'ttnn.add', outputs: id === 1 ? [tensor] : [] }),
                ),
            });
        }

        if (String(url) === Endpoints.OPERATION_BUFFERS) {
            return Promise.resolve({
                data: operationIds.map((id) => ({
                    id,
                    name: 'ttnn.add',
                    buffers: snapshots[id - 1].map((address) => ({
                        address,
                        size: 64,
                        buffer_type: BufferType.L1,
                        device_id: 0,
                    })),
                })),
            });
        }

        return Promise.resolve({ data: [] });
    });

const renderWithReport = <T,>(hook: () => T, range: NumberRange | null) => {
    const store = createStore();
    store.set(activeProfilerReportAtom, { path: 'testPath', reportName: 'test' });
    store.set(selectedOperationRangeAtom, range);

    return { ...renderHookWithStore(hook, store), store };
};

const renderTensors = async (range: NumberRange | null, bufferType?: BufferType) => {
    const { result } = renderWithReport(() => useCreateTensorsByOperationByIdList(bufferType), range);
    await waitFor(() => expect(result.current.status).toBe('success'));
    return result.current;
};

const buffersRequests = () =>
    vi.mocked(axiosInstance.get).mock.calls.filter(([url]) => String(url) === Endpoints.OPERATION_BUFFERS);

const renderLateDeallocations = async (range: NumberRange | null) => {
    const { result } = renderWithReport(() => useGetTensorDeallocationReportByOperation(), range);
    await waitFor(() => expect(result.current.status).toBe('success'));
    return result.current.lateDeallocationsByOperation;
};

const tensorIdAt = (tensorsByOperation: Map<number, Map<number, { id: number }>>, operationId: number) =>
    tensorsByOperation.get(operationId)?.get(ADDRESS)?.id;

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(cleanup);

describe('useCreateTensorsByOperationByIdList', () => {
    it('clears an address whose buffer left the snapshot before the selected range', async () => {
        mockReport([[ADDRESS], [200], [ADDRESS], [ADDRESS]]);

        const { tensorListByOperation } = await renderTensors([3, 4]);

        expect(tensorListByOperation.get(3)).toEqual(new Map());
        expect(tensorListByOperation.get(4)).toEqual(new Map());
    });

    it('maps operations outside the selected range to an empty map, and keeps the ones in it', async () => {
        mockReport([[ADDRESS], [ADDRESS], [ADDRESS], [ADDRESS]]);

        const { tensorListByOperation } = await renderTensors([3, 4]);

        expect([...tensorListByOperation.keys()]).toEqual([1, 2, 3, 4]);
        expect(tensorListByOperation.get(1)).toEqual(new Map());
        expect(tensorListByOperation.get(2)).toEqual(new Map());
        expect(tensorIdAt(tensorListByOperation, 3)).toBe(TENSOR_ID);
        expect(tensorIdAt(tensorListByOperation, 4)).toBe(TENSOR_ID);
    });

    it('credits every operation when no range is selected', async () => {
        mockReport([[ADDRESS], [ADDRESS], [ADDRESS], [ADDRESS]]);

        const { tensorListByOperation } = await renderTensors(null);

        expect([1, 2, 3, 4].map((id) => tensorIdAt(tensorListByOperation, id))).toEqual([
            TENSOR_ID,
            TENSOR_ID,
            TENSOR_ID,
            TENSOR_ID,
        ]);
    });

    it('clears an address a deallocate call freed before the selected range', async () => {
        mockReport([[ADDRESS], [ADDRESS], [ADDRESS], [ADDRESS]], 2);

        const { tensorListByOperation } = await renderTensors([3, 4]);

        expect(tensorListByOperation.get(3)).toEqual(new Map());
        expect(tensorListByOperation.get(4)).toEqual(new Map());
    });

    it('shares one empty map across the operations outside the selected range', async () => {
        mockReport([[ADDRESS], [ADDRESS], [ADDRESS], [ADDRESS]]);

        const { tensorListByOperation } = await renderTensors([3, 4]);

        expect(tensorListByOperation.get(1)).toBe(tensorListByOperation.get(2));
    });

    it('recuts the map when the range changes, without fetching the buffers again', async () => {
        mockReport([[ADDRESS], [ADDRESS], [ADDRESS], [ADDRESS]]);
        const { result, store } = renderWithReport(() => useCreateTensorsByOperationByIdList(), [3, 4]);
        await waitFor(() => expect(tensorIdAt(result.current.tensorListByOperation, 3)).toBe(TENSOR_ID));

        act(() => store.set(selectedOperationRangeAtom, null));

        await waitFor(() =>
            expect([1, 2, 3, 4].map((id) => tensorIdAt(result.current.tensorListByOperation, id))).toEqual([
                TENSOR_ID,
                TENSOR_ID,
                TENSOR_ID,
                TENSOR_ID,
            ]),
        );
        expect(buffersRequests()).toHaveLength(1);
    });

    it('asks for the buffers of the type it was given', async () => {
        mockReport([[ADDRESS]]);

        await renderTensors(null, BufferType.DRAM);

        expect(buffersRequests()).toEqual([
            [Endpoints.OPERATION_BUFFERS, { params: { buffer_type: BufferType.DRAM } }],
        ]);
    });

    it('limits the unique buffers to the selected range', async () => {
        mockReport([[ADDRESS], [ADDRESS], [ADDRESS], [ADDRESS]]);

        const ranged = await renderTensors([2, 3]);
        const whole = await renderTensors(null);

        expect(ranged.uniqueBuffersByOperationList?.map(({ id }) => id)).toEqual([2, 3]);
        expect(whole.uniqueBuffersByOperationList?.map(({ id }) => id)).toEqual([1, 2, 3, 4]);
    });
});

describe('useGetTensorDeallocationReportByOperation over a selected range', () => {
    it('reports no late deallocation for a buffer that left before the range', async () => {
        mockReport([[ADDRESS], [200], [ADDRESS], [ADDRESS]]);

        const lateDeallocations = await renderLateDeallocations([3, 4]);

        expect(lateDeallocations.size).toBe(0);
    });

    it('reports the operations in the range only', async () => {
        mockReport([[ADDRESS], [ADDRESS], [ADDRESS], [ADDRESS]]);

        const lateDeallocations = await renderLateDeallocations([3, 4]);

        expect([...lateDeallocations.keys()]).toEqual([3, 4]);
        expect(lateDeallocations.get(3)?.map(({ id }) => id)).toEqual([TENSOR_ID]);
    });
});
