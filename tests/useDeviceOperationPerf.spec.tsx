// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeviceOperationPerf, useLinkedReportDeviceTimeTotalUs } from '../src/hooks/useDeviceOperationPerf';
import { useGetDeviceOperationListPerfByOpId } from '../src/hooks/useAPI';
import { useReportLinkMatch } from '../src/hooks/useReportLinkMatch';
import { ReportLinkMatchResult } from '../src/definitions/ReportLinks';
import { ReportFolder } from '../src/definitions/Reports';
import { activePerformanceReportAtom } from '../src/store/app';
import { DeviceOperationMapping } from '../src/model/DeviceOperationMapping';
import { PerfTableRow } from '../src/model/PerfTable';
import { mockLinkedPerformanceReport } from './helpers/linkedReports';
import { BGE_M3_CUMSUM, makeRawPerfRow } from './helpers/perfRowFixtures';

vi.mock('../src/hooks/useAPI', () => ({
    useLinkedPerformanceReport: vi.fn(),
    useGetDeviceOperationListPerfByOpId: vi.fn(),
}));

vi.mock('../src/hooks/useReportLinkMatch', () => ({
    useReportLinkMatch: vi.fn(),
}));

const OPERATION_ID = 4;

const givenMatches = (mappingsByOpId: Map<number, DeviceOperationMapping[]>) =>
    vi.mocked(useGetDeviceOperationListPerfByOpId).mockReturnValue(mappingsByOpId);

const scopeMapping = (startNodeId: number, row: PerfTableRow | undefined): DeviceOperationMapping => ({
    name: row?.raw_op_code ?? 'PermuteDeviceOperation',
    id: OPERATION_ID,
    operationName: 'ttnn.cumsum',
    startNodeId,
    perfData: row,
});

const { firstPermute, secondPermute } = BGE_M3_CUMSUM;

const renderPerf = () => renderHook(() => useDeviceOperationPerf(OPERATION_ID)).result.current;

beforeEach(() => {
    vi.mocked(useReportLinkMatch).mockReturnValue(ReportLinkMatchResult.LINKED);
    mockLinkedPerformanceReport([firstPermute, secondPermute]);
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

    it('says whether a performance report is selected, which tells a missing one from a failed read', () => {
        const store = createStore();
        store.set(activePerformanceReportAtom, { path: 'perf', reportName: 'perf' } as ReportFolder);
        const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

        expect(renderPerf().hasPerformanceReport).toBe(false);
        expect(
            renderHook(() => useDeviceOperationPerf(OPERATION_ID), { wrapper }).result.current.hasPerformanceReport,
        ).toBe(true);
    });

    it("sums every row's countable device time for the share", () => {
        mockLinkedPerformanceReport([
            makeRawPerfRow({ device_time: '10' }),
            makeRawPerfRow({ device_time: '30.5' }),
            makeRawPerfRow({ device_time: '' }),
            makeRawPerfRow({ device_time: '-2' }),
        ]);

        expect(renderPerf().totalDeviceTimeUs).toBe(40.5);
    });

    it('gives the operations list the same total, and none before the linked report loads', () => {
        const renderTotal = () => renderHook(() => useLinkedReportDeviceTimeTotalUs()).result.current;

        expect(renderTotal()).toBe(renderPerf().totalDeviceTimeUs);
        expect(renderTotal()).toBe(19.977);

        mockLinkedPerformanceReport(undefined);

        expect(renderTotal()).toBe(0);
    });

    it('sums the linked report once however many readers ask for its total', () => {
        let deviceTimeReads = 0;
        const countedRows = Array.from({ length: 4 }, (_, index) =>
            Object.defineProperty(makeRawPerfRow({ id: `${index}` }), 'device_time', {
                get: () => {
                    deviceTimeReads += 1;
                    return '10';
                },
            }),
        );
        mockLinkedPerformanceReport(countedRows);

        const totals = [1, 2, 3].map(() => renderHook(() => useLinkedReportDeviceTimeTotalUs()).result.current);

        expect(totals).toEqual([40, 40, 40]);
        expect(renderPerf().totalDeviceTimeUs).toBe(40);
        expect(deviceTimeReads).toBe(countedRows.length);
    });

    it("says whether the linked report has hardware counters, from its envelope rather than its rows' keys", () => {
        expect(renderPerf().hasHardwareCounters).toBe(false);

        mockLinkedPerformanceReport([firstPermute], { has_hardware_counters: true });

        expect(renderPerf().hasHardwareCounters).toBe(true);
    });

    it.each([
        [undefined, false],
        [null, false],
        [1, false],
        [2, true],
    ])('reads a report naming %s devices as multi-device: %s', (deviceCount, isMultiDevice) => {
        mockLinkedPerformanceReport([firstPermute], { device_count: deviceCount });

        expect(renderPerf().isMultiDeviceReport).toBe(isMultiDevice);
    });
});
