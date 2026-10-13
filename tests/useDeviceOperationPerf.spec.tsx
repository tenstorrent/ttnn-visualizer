// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeviceOperationPerf } from '../src/hooks/useDeviceOperationPerf';
import { useGetDeviceOperationListPerfByOpId, useLinkedPerformanceReport } from '../src/hooks/useAPI';
import { useReportLinkMatch } from '../src/hooks/useReportLinkMatch';
import { ReportLinkMatchResult } from '../src/definitions/ReportLinks';
import { DeviceOperationMapping } from '../src/model/DeviceOperationMapping';
import { PerfTableRow } from '../src/model/PerfTable';
import { makeRawPerfRow } from './helpers/perfRowFixtures';

vi.mock('../src/hooks/useAPI', () => ({
    useLinkedPerformanceReport: vi.fn(),
    useGetDeviceOperationListPerfByOpId: vi.fn(),
}));

vi.mock('../src/hooks/useReportLinkMatch', () => ({
    useReportLinkMatch: vi.fn(),
}));

const OPERATION_ID = 4;

const givenLinkedReport = (rows: PerfTableRow[] | undefined) =>
    vi
        .mocked(useLinkedPerformanceReport)
        .mockReturnValue({ data: rows && { report: rows } } as ReturnType<typeof useLinkedPerformanceReport>);

const givenMatches = (mappingsByOpId: Map<number, DeviceOperationMapping[]>) =>
    vi.mocked(useGetDeviceOperationListPerfByOpId).mockReturnValue(mappingsByOpId);

const scopeMapping = (startNodeId: number, row: PerfTableRow | undefined): DeviceOperationMapping => ({
    name: row?.raw_op_code ?? 'PermuteDeviceOperation',
    id: OPERATION_ID,
    operationName: 'ttnn.cumsum',
    startNodeId,
    perfData: row,
});

const firstPermute = makeRawPerfRow({ id: '5', raw_op_code: 'PermuteDeviceOperation', device_time: '14.418' });
const secondPermute = makeRawPerfRow({ id: '7', raw_op_code: 'PermuteDeviceOperation', device_time: '5.559' });

const renderPerf = () => renderHook(() => useDeviceOperationPerf(OPERATION_ID)).result.current;

beforeEach(() => {
    vi.mocked(useReportLinkMatch).mockReturnValue(ReportLinkMatchResult.LINKED);
    givenLinkedReport([firstPermute, secondPermute]);
    givenMatches(new Map([[OPERATION_ID, [scopeMapping(101, firstPermute), scopeMapping(105, secondPermute)]]]));
});

describe('useDeviceOperationPerf', () => {
    it.each([ReportLinkMatchResult.PENDING, ReportLinkMatchResult.UNLINKED, ReportLinkMatchResult.UNAVAILABLE])(
        'passes a %s link through, with no rows',
        (linkStatus) => {
            vi.mocked(useReportLinkMatch).mockReturnValue(linkStatus);

            const perf = renderPerf();

            expect(perf.linkStatus).toBe(linkStatus);
            expect(perf.rowByStartNodeId.size).toBe(0);
        },
    );

    it("keys each device operation's typed row on its scope once the reports link", () => {
        givenMatches(
            new Map([
                [OPERATION_ID, [scopeMapping(101, firstPermute), scopeMapping(105, secondPermute)]],
                [OPERATION_ID + 1, [{ ...scopeMapping(200, makeRawPerfRow()), id: OPERATION_ID + 1 }]],
            ]),
        );

        const perf = renderPerf();

        expect(perf.linkStatus).toBe(ReportLinkMatchResult.LINKED);
        expect([...perf.rowByStartNodeId.keys()]).toEqual([101, 105]);
        expect(perf.rowByStartNodeId.get(101)).toMatchObject({ id: 5, device_time: 14.418, op: OPERATION_ID });
        expect(perf.rowByStartNodeId.get(105)).toMatchObject({ id: 7, device_time: 5.559 });
    });

    it('leaves out a device operation the match gave no perf row', () => {
        givenMatches(new Map([[OPERATION_ID, [scopeMapping(101, undefined), scopeMapping(105, secondPermute)]]]));

        expect([...renderPerf().rowByStartNodeId.keys()]).toEqual([105]);
    });

    it("sums every row's countable device time for the share", () => {
        givenLinkedReport([
            makeRawPerfRow({ device_time: '10' }),
            makeRawPerfRow({ device_time: '30.5' }),
            makeRawPerfRow({ device_time: '' }),
            makeRawPerfRow({ device_time: '-2' }),
        ]);

        expect(renderPerf().totalDeviceTimeUs).toBe(40.5);
    });
});
