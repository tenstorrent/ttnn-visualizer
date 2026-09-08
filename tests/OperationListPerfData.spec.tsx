// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * This renders once per row of a virtualised list, so it looks its operation up in
 * a shared map keyed on profiler op id rather than filtering the whole match
 * (#1812). The lookup key is the part worth pinning: keyed on anything else — the
 * perf row's own id, say — every row would show another operation's perf data, or
 * none, with no other assertion in the suite noticing.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationListPerfData from '../src/components/OperationListPerfData';
import { useGetDeviceOperationListPerfByOpId } from '../src/hooks/useAPI';
import { DeviceOperationMapping } from '../src/model/DeviceOperationMapping';
import { OperationDescription } from '../src/model/APIData';
import { PerfTableRow } from '../src/model/PerfTable';

vi.mock('../src/hooks/useAPI', () => ({
    useGetDeviceOperationListPerfByOpId: vi.fn(),
}));

const OP_ID = 7;

const perfRow = (rawOpCode: string, deviceTime: string): PerfTableRow =>
    ({
        id: '1',
        raw_op_code: rawOpCode,
        cores: '64',
        device_time: deviceTime,
        total_percent: '12.5',
    }) as PerfTableRow;

const mapping = (name: string, deviceTime: string): DeviceOperationMapping => ({
    name,
    id: OP_ID,
    operationName: `ttnn.${name.toLowerCase()}`,
    perfData: perfRow(name, deviceTime),
});

const operation = (deviceOperationNameList: string[]): OperationDescription =>
    ({ id: OP_ID, name: 'ttnn.matmul', deviceOperationNameList }) as OperationDescription;

const mockMatch = (entries: [number, DeviceOperationMapping[]][]) =>
    vi.mocked(useGetDeviceOperationListPerfByOpId).mockReturnValue(new Map(entries));

beforeEach(vi.clearAllMocks);

// RTL auto-cleanup is off in this project, so an uncleaned tree leaves its rows in
// the document and the next case's queries match both.
afterEach(cleanup);

describe('OperationListPerfData', () => {
    it('renders every device row matched to the operation, in match order', () => {
        // A multi-device run: one operation, one perf row per device.
        mockMatch([[OP_ID, [mapping('Matmul', '100'), mapping('Matmul', '250')]]]);

        render(<OperationListPerfData operation={operation(['Matmul'])} />);

        expect(screen.getAllByText('Matmul')).toHaveLength(2);
        expect(screen.getByText(/100/)).toBeDefined();
        expect(screen.getByText(/250/)).toBeDefined();
    });

    it('looks the operation up by its own id, not by any other row in the map', () => {
        // The neighbouring entry is what a mis-keyed map hands back.
        mockMatch([
            [OP_ID, [mapping('Matmul', '100')]],
            [OP_ID + 1, [mapping('Softmax', '999')]],
        ]);

        render(<OperationListPerfData operation={operation(['Matmul'])} />);

        expect(screen.getByText('Matmul')).toBeDefined();
        expect(screen.queryByText('Softmax')).toBeNull();
        expect(screen.queryByText(/999/)).toBeNull();
    });

    it('falls back to the memory report’s device operation names when the operation did not match', () => {
        mockMatch([[OP_ID + 1, [mapping('Softmax', '100')]]]);

        render(<OperationListPerfData operation={operation(['Matmul', 'Softmax'])} />);

        expect(screen.getByText('Matmul')).toBeDefined();
        expect(screen.queryByText(/100/)).toBeNull();
    });

    it('renders nothing rather than throwing when the match is empty', () => {
        mockMatch([]);

        expect(() => render(<OperationListPerfData operation={operation([])} />)).not.toThrow();
    });
});
