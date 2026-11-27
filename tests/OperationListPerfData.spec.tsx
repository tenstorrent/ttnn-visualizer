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
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperationListPerfData from '../src/components/OperationListPerfData';
import { DeviceOperationPerfSummary } from '../src/components/operation-details/DeviceOperationPerf';
import { DEVICE_TIME_SHARE_SUFFIX } from '../src/definitions/Performance';
import { ReportLinkMatchResult } from '../src/definitions/ReportLinks';
import { useGetDeviceOperationListPerfByOpId } from '../src/hooks/useAPI';
import { useDeviceOperationPerf, useLinkedReportDeviceTimeTotalUs } from '../src/hooks/useDeviceOperationPerf';
import { useReportLinkMatch } from '../src/hooks/useReportLinkMatch';
import { DeviceOperationMapping } from '../src/model/DeviceOperationMapping';
import { OperationDescription } from '../src/model/APIData';
import { PerfTableRow } from '../src/model/PerfTable';
import { mockLinkedPerformanceReport } from './helpers/linkedReports';
import { BGE_M3_CUMSUM, BGE_M3_DEVICE_TIME_US, makeRawPerfRow } from './helpers/perfRowFixtures';

vi.mock('../src/hooks/useAPI', () => ({
    useGetDeviceOperationListPerfByOpId: vi.fn(),
    useLinkedPerformanceReport: vi.fn(),
}));

vi.mock('../src/hooks/useReportLinkMatch', () => ({
    useReportLinkMatch: vi.fn(),
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
    startNodeId: 0,
    perfData: perfRow(name, deviceTime),
});

const mappingOf = (row: PerfTableRow, startNodeId: number): DeviceOperationMapping => ({
    name: row.raw_op_code,
    id: OP_ID,
    operationName: 'ttnn.cumsum',
    startNodeId,
    perfData: row,
});

const operation = (deviceOperationNameList: string[]): OperationDescription =>
    ({ id: OP_ID, name: 'ttnn.matmul', deviceOperationNameList }) as OperationDescription;

const mockMatch = (entries: [number, DeviceOperationMapping[]][]) =>
    vi.mocked(useGetDeviceOperationListPerfByOpId).mockReturnValue(new Map(entries));

const { firstPermute, accumulation, secondPermute } = BGE_M3_CUMSUM;
// parseFloat reads this as 1 µs and Number as NaN; both views must read it as the app's parse does.
const trailingExponent = makeRawPerfRow({ id: '8', raw_op_code: 'TilizeDeviceOperation', device_time: '1e' });
const BGE_M3_REPORT = [
    firstPermute,
    accumulation,
    secondPermute,
    trailingExponent,
    makeRawPerfRow({ id: '9', device_time: '49852.293' }),
    // tt-perf-report blanks a device time it judges invalid; it counts towards nothing.
    makeRawPerfRow({ id: '10', device_time: '' }),
];

const DEVICE_TIME_SHARE = new RegExp(`(<?[\\d.]+%) ${DEVICE_TIME_SHARE_SUFFIX}`, 'g');

const sharesIn = (element: HTMLElement): string[] =>
    [...(element.textContent ?? '').matchAll(DEVICE_TIME_SHARE)].map(([, share]) => share);

const renderRow = (deviceOperationNames: string[], totalDeviceTimeUs = BGE_M3_DEVICE_TIME_US) =>
    render(
        <OperationListPerfData
            operation={operation(deviceOperationNames)}
            totalDeviceTimeUs={totalDeviceTimeUs}
        />,
    ).container;

// Each list row as OperationList renders it, with the total read once from the linked report.
const LinkedListRow = () => (
    <OperationListPerfData
        operation={operation(['Permute'])}
        totalDeviceTimeUs={useLinkedReportDeviceTimeTotalUs()}
    />
);

const OperationDetailsShares = () => {
    const { rowByStartNodeId, totalDeviceTimeUs } = useDeviceOperationPerf(OP_ID);

    return [...rowByStartNodeId].map(([startNodeId, row]) => (
        <DeviceOperationPerfSummary
            key={startNodeId}
            row={row}
            totalDeviceTimeUs={totalDeviceTimeUs}
        />
    ));
};

beforeEach(() => {
    vi.clearAllMocks();
    mockLinkedPerformanceReport(BGE_M3_REPORT);
    vi.mocked(useReportLinkMatch).mockReturnValue(ReportLinkMatchResult.LINKED);
});

// RTL auto-cleanup is off in this project, so an uncleaned tree leaves its rows in
// the document and the next case's queries match both.
afterEach(cleanup);

describe('OperationListPerfData', () => {
    it('renders every device row matched to the operation, in match order', () => {
        // A multi-device run: one operation, one perf row per device.
        mockMatch([[OP_ID, [mapping('Matmul', '100'), mapping('Matmul', '250')]]]);

        renderRow(['Matmul']);

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

        renderRow(['Matmul']);

        expect(screen.getByText('Matmul')).toBeDefined();
        expect(screen.queryByText('Softmax')).toBeNull();
        expect(screen.queryByText(/999/)).toBeNull();
    });

    it('falls back to the memory report’s device operation names when the operation did not match', () => {
        mockMatch([[OP_ID + 1, [mapping('Softmax', '100')]]]);

        renderRow(['Matmul', 'Softmax']);

        expect(screen.getByText('Matmul')).toBeDefined();
        expect(screen.queryByText(/100/)).toBeNull();
    });

    it('renders nothing rather than throwing when the match is empty', () => {
        mockMatch([]);

        expect(() => renderRow([])).not.toThrow();
    });

    describe('share of device time', () => {
        it("shows a device operation's share of the report's device time, not its Total %", () => {
            mockMatch([[OP_ID, [mappingOf(accumulation, 101)]]]);

            const container = renderRow(['Accumulation']);

            // The whole line, so a Total % in any format fails it.
            expect(container.textContent).toBe(
                "AccumulationDeviceOperation1 core, execution time 115.73 µs (0.2% of the report's device time), " +
                    '2.5 µs op-to-op gap.',
            );
        });

        it('agrees with Operation Details on every device operation of the operation', () => {
            mockMatch([
                [
                    OP_ID,
                    [
                        mappingOf(firstPermute, 101),
                        mappingOf(accumulation, 103),
                        mappingOf(secondPermute, 105),
                        mappingOf(trailingExponent, 107),
                    ],
                ],
            ]);

            const list = render(<LinkedListRow />).container;
            const details = render(<OperationDetailsShares />).container;

            expect(sharesIn(list)).toEqual(['<0.1%', '0.2%', '<0.1%', '<0.1%']);
            expect(sharesIn(list)).toEqual(sharesIn(details));
        });

        it('leaves the share out for a device operation with no device time', () => {
            mockMatch([
                [OP_ID, [mappingOf(makeRawPerfRow({ raw_op_code: 'TilizeDeviceOperation', device_time: '' }), 101)]],
            ]);

            const container = renderRow(['Tilize']);

            expect(screen.getByText('TilizeDeviceOperation')).toBeInTheDocument();
            expect(container).not.toHaveTextContent('%');
        });

        it('leaves the share out when the report has no device time to divide by', () => {
            mockMatch([[OP_ID, [mapping('Matmul', '100')]]]);

            const container = renderRow(['Matmul'], 0);

            expect(container).toHaveTextContent('execution time 100 µs');
            expect(container).not.toHaveTextContent('%');
        });
    });
});
