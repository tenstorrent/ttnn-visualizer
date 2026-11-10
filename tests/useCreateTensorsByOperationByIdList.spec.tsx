// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The hook builds the address map over every operation's buffers, then cuts it to the selected
 * range, so a buffer that left before the range still clears its address inside it. #2272
 */

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NumberRange } from '@blueprintjs/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateTensorsByOperationByIdList, useGetTensorDeallocationReportByOperation } from '../src/hooks/useAPI';
import { activeProfilerReportAtom, selectedOperationRangeAtom } from '../src/store/app';
import axiosInstance from '../src/libs/axiosInstance';
import Endpoints from '../src/definitions/Endpoints';
import { BufferType } from '../src/model/BufferType';
import { buildOperationDescription, buildTensor } from './helpers/operationDetailsFixtures';

vi.mock('../src/libs/axiosInstance', () => ({
    default: {
        get: vi.fn(),
    },
    getOrCreateInstanceId: () => 'test-instance',
}));

const TENSOR_ID = 10;
const ADDRESS = 100;

/** Operation 1 outputs tensor 10 at address 100 and is its last use; operation `i + 1` records `snapshots[i]`. */
const mockReport = (snapshots: number[][]) =>
    vi.mocked(axiosInstance.get).mockImplementation((url) => {
        const operationIds = snapshots.map((_, index) => index + 1);

        if (String(url) === Endpoints.OPERATIONS_LIST) {
            const tensor = buildTensor({ id: TENSOR_ID, address: ADDRESS, consumers: [1] });

            return Promise.resolve({
                data: operationIds.map((id) =>
                    buildOperationDescription({ id, name: 'ttnn.add', outputs: id === 1 ? [tensor] : [] }),
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

// A fresh client per test: `staleTime: Infinity` would otherwise let one test's report answer the next.
const renderWithReport = <T,>(hook: () => T, range: NumberRange | null) => {
    const store = createStore();
    store.set(activeProfilerReportAtom, { path: 'testPath', reportName: 'test' });
    store.set(selectedOperationRangeAtom, range);
    const queryClient = new QueryClient();

    return renderHook(hook, {
        wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    });
};

const renderTensors = async (range: NumberRange | null) => {
    const { result } = renderWithReport(() => useCreateTensorsByOperationByIdList(), range);
    await waitFor(() => expect(result.current.status).toBe('success'));
    return result.current;
};

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
