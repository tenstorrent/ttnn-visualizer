// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAllocationFailures } from '../src/hooks/useAllocationFailures';
import { Node, NodeType, OperationDescription } from '../src/model/APIData';
import { AllocationFailureKind } from '../src/definitions/AllocationFailure';
import { mockLinkedReports, resetLinkedReportMocks } from './helpers/linkedReports';

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
            error_type: 'RuntimeError',
            error_message: message,
            stack_trace: '',
            timestamp: '',
            rank: 0,
        },
        device_operations: [
            node(NodeType.function_start, 'Halo'),
            node(NodeType.function_end, 'Halo'),
            node(NodeType.function_start, 'Conv2d'),
            node(NodeType.function_end, 'Conv2d', { aborted: 'true' }),
        ],
    });

// The table's lookup with devices unmerged: op 2's device op ran on two devices.
const UNMERGED_OP_IDS_MAP = [
    { opId: 2, perfId: '2' },
    { opId: 2, perfId: '3' },
];

beforeEach(resetLinkedReportMocks);

describe('useAllocationFailures', () => {
    it('lists each allocation failure with the device op that failed and the rows that ran', () => {
        const opIdsMap = [
            { opId: 1, perfId: '1' },
            { opId: 2, perfId: '2' },
        ];
        mockLinkedReports([operation(1), failedOperation(2)], opIdsMap);

        const { result } = renderHook(() => useAllocationFailures(opIdsMap));

        expect(result.current.listings).toHaveLength(1);
        expect(result.current.listings[0]).toMatchObject({
            failure: { operationId: 2, operationName: 'ttnn.conv2d', kind: AllocationFailureKind.BANK_OUT_OF_MEMORY },
            failedDeviceOperations: ['Conv2d'],
            ranDeviceOperationCount: 1,
            linkedRowCount: 1,
        });
        expect(result.current.allocationFailureByOpId.get(2)?.operationId).toBe(2);
        expect(result.current.allocationFailureByOpId.has(1)).toBe(false);
    });

    // #2084: the Op failed flag lands on every device's row once devices are unmerged, so the
    // listing counts those rows while still counting each device op that ran once.
    it('counts every device row of the earlier device ops when devices are unmerged', () => {
        mockLinkedReports([operation(1), failedOperation(2)], [{ opId: 2, perfId: '2' }]);

        const { result } = renderHook(() => useAllocationFailures(UNMERGED_OP_IDS_MAP));

        expect(result.current.listings[0]).toMatchObject({ ranDeviceOperationCount: 1, linkedRowCount: 2 });
    });

    // `useDramFallbacks` memoises on the failure map, so a merge toggle must not rebuild it.
    it('keeps the failure map when only the table lookup changes', () => {
        const opIdsMap = [{ opId: 2, perfId: '2' }];
        mockLinkedReports([operation(1), failedOperation(2)], opIdsMap);

        const { result, rerender } = renderHook(({ perfTableOpIdsMap }) => useAllocationFailures(perfTableOpIdsMap), {
            initialProps: { perfTableOpIdsMap: opIdsMap },
        });
        const merged = result.current;

        rerender({ perfTableOpIdsMap: UNMERGED_OP_IDS_MAP });

        expect(result.current.listings[0]?.linkedRowCount).toBe(2);
        expect(result.current.allocationFailureByOpId).toBe(merged.allocationFailureByOpId);
    });

    it('lists nothing when the reports are not linked, so an unrelated run is never blamed', () => {
        mockLinkedReports([failedOperation(2)], []);

        const { result } = renderHook(() => useAllocationFailures([]));

        expect(result.current.listings).toEqual([]);
        expect(result.current.allocationFailureByOpId.size).toBe(0);
    });

    it('ignores errors that are not allocation failures', () => {
        const opIdsMap = [{ opId: 1, perfId: '1' }];
        mockLinkedReports([failedOperation(2, 'TypeError: bad argument')], opIdsMap);

        const { result } = renderHook(() => useAllocationFailures(opIdsMap));

        expect(result.current.listings).toEqual([]);
    });
});
