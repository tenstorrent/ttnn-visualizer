// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeviceOperationPerf } from '../src/hooks/useDeviceOperationPerf';
import { useGetDeviceOperationListPerfByOpId, useLinkedPerformanceReport } from '../src/hooks/useAPI';
import { PerfOverlayStatus } from '../src/definitions/PerfOverlayStatus';
import { DeviceOperationMapping } from '../src/model/DeviceOperationMapping';
import { PerfTableRow } from '../src/model/PerfTable';
import { activePerformanceReportAtom } from '../src/store/app';
import { AtomProvider } from './helpers/atomProvider';
import { makeRawPerfRow } from './helpers/perfRowFixtures';

vi.mock('../src/hooks/useAPI', () => ({
    useLinkedPerformanceReport: vi.fn(),
    useGetDeviceOperationListPerfByOpId: vi.fn(),
}));

const OPERATION_ID = 4;
const ACTIVE_REPORT = { path: 'perf_report', reportName: 'perf_report' };

const givenLinkedReport = (rows: PerfTableRow[] | undefined) =>
    vi
        .mocked(useLinkedPerformanceReport)
        .mockReturnValue({ data: rows && { report: rows } } as ReturnType<typeof useLinkedPerformanceReport>);

const givenMatches = (mappingsByOpId: Map<number, DeviceOperationMapping[]>) =>
    vi.mocked(useGetDeviceOperationListPerfByOpId).mockReturnValue(mappingsByOpId);

const scopeMapping = (startNodeId: number | undefined, row: PerfTableRow | undefined): DeviceOperationMapping => ({
    name: row?.raw_op_code ?? 'PermuteDeviceOperation',
    id: OPERATION_ID,
    operationName: 'ttnn.cumsum',
    startNodeId,
    perfData: row,
});

const renderPerf = (isReportSelected = true) =>
    renderHook(() => useDeviceOperationPerf(OPERATION_ID), {
        wrapper: ({ children }: { children: ReactNode }) => (
            <AtomProvider initialValues={isReportSelected ? [[activePerformanceReportAtom, ACTIVE_REPORT]] : []}>
                {children}
            </AtomProvider>
        ),
    }).result.current;

beforeEach(() => {
    givenLinkedReport(undefined);
    givenMatches(new Map());
});

describe('useDeviceOperationPerf', () => {
    it('reports no performance report when none is selected', () => {
        const perf = renderPerf(false);

        expect(perf.status).toBe(PerfOverlayStatus.UNAVAILABLE);
        expect(perf.isLoading).toBe(false);
        expect(perf.rowByStartNodeId.size).toBe(0);
    });

    it('waits while the selected report loads', () => {
        expect(renderPerf().isLoading).toBe(true);
    });

    it('reports a loaded report that does not match the memory report', () => {
        givenLinkedReport([makeRawPerfRow()]);

        const perf = renderPerf();

        expect(perf.status).toBe(PerfOverlayStatus.UNLINKED);
        expect(perf.isLoading).toBe(false);
    });

    it("keys each device operation's typed row on its scope", () => {
        const firstPermute = makeRawPerfRow({ id: '5', raw_op_code: 'PermuteDeviceOperation', device_time: '14.418' });
        const secondPermute = makeRawPerfRow({ id: '7', raw_op_code: 'PermuteDeviceOperation', device_time: '5.559' });
        givenLinkedReport([firstPermute, secondPermute]);
        givenMatches(
            new Map([
                [OPERATION_ID, [scopeMapping(101, firstPermute), scopeMapping(105, secondPermute)]],
                [OPERATION_ID + 1, [{ ...scopeMapping(200, makeRawPerfRow()), id: OPERATION_ID + 1 }]],
            ]),
        );

        const perf = renderPerf();

        expect(perf.status).toBe(PerfOverlayStatus.READY);
        expect([...perf.rowByStartNodeId.keys()]).toEqual([101, 105]);
        expect(perf.rowByStartNodeId.get(101)).toMatchObject({ id: 5, device_time: 14.418, op: OPERATION_ID });
        expect(perf.rowByStartNodeId.get(105)).toMatchObject({ id: 7, device_time: 5.559 });
    });

    it('leaves out a match it cannot place on a scope', () => {
        const row = makeRawPerfRow({ id: '5' });
        givenLinkedReport([row]);
        givenMatches(new Map([[OPERATION_ID, [scopeMapping(undefined, row), scopeMapping(101, undefined)]]]));

        const perf = renderPerf();

        expect(perf.status).toBe(PerfOverlayStatus.READY);
        expect(perf.rowByStartNodeId.size).toBe(0);
    });

    it("sums every row's device time for the share, skipping rows without one", () => {
        givenLinkedReport([
            makeRawPerfRow({ device_time: '10' }),
            makeRawPerfRow({ device_time: '30.5' }),
            makeRawPerfRow({ device_time: '' }),
        ]);

        expect(renderPerf().totalDeviceTimeUs).toBe(40.5);
    });
});
