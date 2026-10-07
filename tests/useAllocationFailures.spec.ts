// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAllocationFailures } from '../src/hooks/useAllocationFailures';
import { useOpToPerfIdFiltered, useOperationsList } from '../src/hooks/useAPI';
import { Node, NodeType, OperationDescription } from '../src/model/APIData';
import { AllocationFailureKind } from '../src/definitions/AllocationFailure';

vi.mock('../src/hooks/useAPI', () => ({
    useOperationsList: vi.fn(),
    useOpToPerfIdFiltered: vi.fn(),
}));

const OUT_OF_MEMORY =
    'Out of Memory: Not enough space to allocate 3276800 B L1 buffer across 4 banks, where each bank needs to store 819200 B, but bank size is only 1382720 B';

const node = (nodeType: NodeType, name: string, params: Record<string, string> = {}): Node =>
    ({ node_type: nodeType, params: { name, ...params } }) as unknown as Node;

const operation = (id: number, overrides: Partial<OperationDescription> = {}): OperationDescription =>
    ({ id, name: `op${id}`, device_operations: [], error: null, ...overrides }) as OperationDescription;

const failedOperation = (id: number, message = OUT_OF_MEMORY): OperationDescription =>
    operation(id, {
        name: 'ttnn.conv2d',
        error: {
            operation_id: id,
            operation_name: 'ttnn.conv2d',
            error_type: 'RuntimeError',
            error_message: message,
            stack_trace: '',
            timestamp: '',
        },
        device_operations: [
            node(NodeType.function_start, 'Halo'),
            node(NodeType.function_end, 'Halo'),
            node(NodeType.function_start, 'Conv2d'),
            node(NodeType.function_end, 'Conv2d', { aborted: 'true' }),
        ],
    });

const mockReports = (operations: OperationDescription[], opIdsMap: ReturnType<typeof useOpToPerfIdFiltered>) => {
    vi.mocked(useOperationsList).mockReturnValue({ data: operations } as ReturnType<typeof useOperationsList>);
    vi.mocked(useOpToPerfIdFiltered).mockReturnValue(opIdsMap);
};

beforeEach(() => {
    vi.mocked(useOperationsList).mockReset();
    vi.mocked(useOpToPerfIdFiltered).mockReset();
});

describe('useAllocationFailures', () => {
    it('lists each allocation failure with the device op that failed and the rows that ran', () => {
        mockReports(
            [operation(1), failedOperation(2)],
            [
                { opId: 1, perfId: '1' },
                { opId: 2, perfId: '2' },
            ],
        );

        const { result } = renderHook(() => useAllocationFailures());

        expect(result.current.listings).toHaveLength(1);
        expect(result.current.listings[0]).toMatchObject({
            failure: { operationId: 2, kind: AllocationFailureKind.BANK_OUT_OF_MEMORY },
            failedDeviceOperations: ['Conv2d'],
            linkedRowCount: 1,
        });
        expect(result.current.allocationFailureByOpId.get(2)?.operationId).toBe(2);
        expect(result.current.allocationFailureByOpId.has(1)).toBe(false);
    });

    it('lists nothing when the reports are not linked, so an unrelated run is never blamed', () => {
        mockReports([failedOperation(2)], []);

        const { result } = renderHook(() => useAllocationFailures());

        expect(result.current.listings).toEqual([]);
        expect(result.current.allocationFailureByOpId.size).toBe(0);
    });

    it('ignores errors that are not allocation failures', () => {
        mockReports([failedOperation(2, 'TypeError: bad argument')], [{ opId: 1, perfId: '1' }]);

        const { result } = renderHook(() => useAllocationFailures());

        expect(result.current.listings).toEqual([]);
    });
});
