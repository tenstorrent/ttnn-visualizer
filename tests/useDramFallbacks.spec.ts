// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDramFallbacks } from '../src/hooks/useDramFallbacks';
import { useOpToPerfIdFiltered, useOperationsList } from '../src/hooks/useAPI';
import { DramFallbackSignal } from '../src/definitions/DramFallback';
import { AllocationFailure } from '../src/model/AllocationFailure';
import { OperationDescription } from '../src/model/APIData';
import { BufferType, StringBufferType } from '../src/model/BufferType';
import { makeAllocationFailure } from './helpers/allocationFailure';
import { makeMemoryConfigArgument, makeOperation, makeTensor } from './helpers/operationDescription';

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
}));

const LINKED: ReturnType<typeof useOpToPerfIdFiltered> = [
    { opId: 1, perfId: '1' },
    { opId: 2, perfId: '2' },
    { opId: 3, perfId: '3' },
];

const mockReports = (
    operations: OperationDescription[] | undefined,
    opIdsMap: ReturnType<typeof useOpToPerfIdFiltered> = LINKED,
) => {
    vi.mocked(useOperationsList).mockReturnValue({ data: operations } as ReturnType<typeof useOperationsList>);
    vi.mocked(useOpToPerfIdFiltered).mockReturnValue(opIdsMap);
};

const dramOutput = makeTensor({ address: 1048576, buffer_type: BufferType.DRAM });
const argumentMismatch = makeOperation({
    id: 3,
    arguments: [makeMemoryConfigArgument(StringBufferType.L1)],
    outputs: [dramOutput],
});

beforeEach(() => {
    vi.mocked(useOperationsList).mockReset();
    vi.mocked(useOpToPerfIdFiltered).mockReset();
});

describe('useDramFallbacks', () => {
    it.each([
        ['before the operations load', undefined],
        ['for a report with no operations', []],
    ])('is empty %s', (_, operations) => {
        mockReports(operations);

        const { result } = renderHook(() => useDramFallbacks(new Map<number, AllocationFailure>()));

        expect(result.current.size).toBe(0);
    });

    it('is empty when the reports are not linked, so an unrelated run is never blamed', () => {
        mockReports([argumentMismatch], []);

        const { result } = renderHook(() => useDramFallbacks(new Map<number, AllocationFailure>()));

        expect(result.current.size).toBe(0);
    });

    it('finds argument mismatches in the linked memory report', () => {
        mockReports([argumentMismatch]);

        const { result } = renderHook(() => useDramFallbacks(new Map<number, AllocationFailure>()));

        expect(result.current.get(3)?.signal).toBe(DramFallbackSignal.ARGUMENT_MISMATCH);
    });

    it('reads retries against the failures it is given', () => {
        mockReports([
            makeOperation({ id: 1, name: 'ttnn.linear' }),
            makeOperation({ id: 2, name: 'ttnn.linear', outputs: [dramOutput] }),
        ]);

        const { result } = renderHook(() =>
            useDramFallbacks(new Map([[1, makeAllocationFailure({ operationId: 1 })]])),
        );

        expect(result.current.get(2)?.signal).toBe(DramFallbackSignal.RETRY_AFTER_FAILURE);
    });

    // The route feeds the result into the table's enrichment memo, so a fresh map per render
    // would re-enrich every row.
    it('returns the same map when re-rendered with the same inputs', () => {
        const allocationFailureByOpId = new Map<number, AllocationFailure>();
        mockReports([argumentMismatch]);

        const { result, rerender } = renderHook(() => useDramFallbacks(allocationFailureByOpId));
        const first = result.current;
        rerender();

        expect(result.current).toBe(first);
    });
});
