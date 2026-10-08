// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDramFallbacks } from '../src/hooks/useDramFallbacks';
import { useOperationsList } from '../src/hooks/useAPI';
import { DramFallbackSignal } from '../src/definitions/DramFallback';
import { AllocationFailure } from '../src/model/AllocationFailure';
import { OperationDescription } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { makeAllocationFailure } from './helpers/allocationFailure';
import { makeOperation, makeTensor, memoryConfigArgument } from './helpers/operationDescription';

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: vi.fn(),
}));

const mockOperations = (operations: OperationDescription[] | undefined) => {
    vi.mocked(useOperationsList).mockReturnValue({ data: operations } as ReturnType<typeof useOperationsList>);
};

const dramOutput = makeTensor({ address: 1048576, buffer_type: BufferType.DRAM });

beforeEach(() => {
    vi.mocked(useOperationsList).mockReset();
});

describe('useDramFallbacks', () => {
    it('is empty before the operations load', () => {
        mockOperations(undefined);

        const { result } = renderHook(() => useDramFallbacks(new Map<number, AllocationFailure>()));

        expect(result.current.size).toBe(0);
    });

    it('finds argument mismatches in the active memory report', () => {
        mockOperations([makeOperation({ id: 3, arguments: [memoryConfigArgument('L1')], outputs: [dramOutput] })]);

        const { result } = renderHook(() => useDramFallbacks(new Map<number, AllocationFailure>()));

        expect(result.current.get(3)?.signal).toBe(DramFallbackSignal.ARGUMENT_MISMATCH);
    });

    it('reads retries against the failures it is given', () => {
        mockOperations([
            makeOperation({ id: 1, name: 'ttnn.linear' }),
            makeOperation({ id: 2, name: 'ttnn.linear', outputs: [dramOutput] }),
        ]);

        const { result } = renderHook(() =>
            useDramFallbacks(new Map([[1, makeAllocationFailure({ operationId: 1 })]])),
        );

        expect(result.current.get(2)?.signal).toBe(DramFallbackSignal.RETRY_AFTER_FAILURE);
    });
});
