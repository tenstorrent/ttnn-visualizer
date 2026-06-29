// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOpPerfRowScores } from '../src/hooks/useOpPerfRowScores';
import { DeviceOperationMapping } from '../src/hooks/useAPI';
import { PerfTableRow } from '../src/definitions/PerfTable';

vi.mock('../src/hooks/useAPI', () => ({
    useGetDeviceOperationListPerf: vi.fn(),
}));

const perfRow = (deviceTimeUs: number): PerfTableRow =>
    ({ device_time: String(deviceTimeUs), raw_op_code: 'mock_op' }) as unknown as PerfTableRow;

const mapping = (id: number, deviceTimeUs: number | null): DeviceOperationMapping => ({
    id,
    name: 'mock_op',
    operationName: 'mock_op',
    perfData: deviceTimeUs === null ? undefined : perfRow(deviceTimeUs),
});

beforeEach(() => {
    vi.resetAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useOpPerfRowScores', () => {
    it('returns isAvailable=false and an empty map when no perf rows are present', async () => {
        const { useGetDeviceOperationListPerf } = await import('../src/hooks/useAPI');
        vi.mocked(useGetDeviceOperationListPerf).mockReturnValue([]);

        const { result } = renderHook(() => useOpPerfRowScores());

        expect(result.current.isAvailable).toBe(false);
        expect(result.current.scoreByOpId.size).toBe(0);
        expect(result.current.minNs).toBe(0);
        expect(result.current.maxNs).toBe(0);
    });

    it('returns isAvailable=false when every mapping is missing perfData', async () => {
        const { useGetDeviceOperationListPerf } = await import('../src/hooks/useAPI');
        vi.mocked(useGetDeviceOperationListPerf).mockReturnValue([mapping(1, null), mapping(2, null)]);

        const { result } = renderHook(() => useOpPerfRowScores());

        expect(result.current.isAvailable).toBe(false);
        expect(result.current.scoreByOpId.size).toBe(0);
    });

    it('aggregates and scores mapped ops, converting µs → ns and placing min at t=0 / max at t=1', async () => {
        const { useGetDeviceOperationListPerf } = await import('../src/hooks/useAPI');
        vi.mocked(useGetDeviceOperationListPerf).mockReturnValue([
            mapping(1, 10),
            mapping(2, 1_000),
            mapping(3, 100_000),
        ]);

        const { result } = renderHook(() => useOpPerfRowScores());

        expect(result.current.isAvailable).toBe(true);
        expect(result.current.scoreByOpId.size).toBe(3);
        expect(result.current.minNs).toBe(10_000);
        expect(result.current.maxNs).toBe(100_000_000);
        expect(result.current.scoreByOpId.get(1)?.t).toBe(0);
        expect(result.current.scoreByOpId.get(3)?.t).toBe(1);
        expect(result.current.scoreByOpId.get(1)?.deviceTimeNs).toBe(10_000);
        expect(result.current.scoreByOpId.get(3)?.deviceTimeNs).toBe(100_000_000);
    });

    it('skips mappings whose device_time fails to parse instead of dropping the whole report', async () => {
        const { useGetDeviceOperationListPerf } = await import('../src/hooks/useAPI');
        vi.mocked(useGetDeviceOperationListPerf).mockReturnValue([
            { id: 1, name: 'a', operationName: 'a', perfData: { device_time: 'NaN' } as unknown as PerfTableRow },
            mapping(2, 50),
        ]);

        const { result } = renderHook(() => useOpPerfRowScores());

        expect(result.current.isAvailable).toBe(true);
        expect(result.current.scoreByOpId.has(1)).toBe(false);
        expect(result.current.scoreByOpId.has(2)).toBe(true);
    });
});
