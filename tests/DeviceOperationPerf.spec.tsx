// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import {
    DeviceOperationPerfSummary,
    OperationDevicePerfSummary,
} from '../src/components/operation-details/DeviceOperationPerf';
import { ReportLinkMatchResult } from '../src/definitions/ReportLinks';
import { enrichRowData } from '../src/functions/enrichPerfRowData';
import { NOT_MODELLED_REASON, SLOW_BOUND_REASON } from '../src/functions/perfBoundAnalysis';
import { PerfTableRow, TypedPerfTableRow } from '../src/model/PerfTable';
import { makeRawPerfRow } from './helpers/perfRowFixtures';

// What the report would show for ttnn.cumsum in bge_m3: three device operations, none of them
// a matmul, so tt-perf-report analyses no roofline for any of them.
const UNANALYSED: Partial<PerfTableRow> = {
    bound: '' as PerfTableRow['bound'],
    bound_analysis: 'none',
    dram: '',
    dram_percent: '',
    flops: '',
    flops_percent: '',
};

const typedRow = (overrides: Partial<PerfTableRow>): TypedPerfTableRow =>
    enrichRowData([makeRawPerfRow({ ...UNANALYSED, ...overrides })], [], null)[0];

const firstPermute = typedRow({ id: '5', raw_op_code: 'PermuteDeviceOperation', device_time: '14.418', cores: '64' });
const accumulation = typedRow({
    id: '6',
    raw_op_code: 'AccumulationDeviceOperation',
    device_time: '115.73',
    cores: '1',
});
const secondPermute = typedRow({ id: '7', raw_op_code: 'PermuteDeviceOperation', device_time: '5.559', cores: '32' });
// tt-perf-report blanks a device time it judges invalid.
const untimed = typedRow({ id: '8', raw_op_code: 'TilizeDeviceOperation', device_time: '', cores: '64' });

const REPORT_DEVICE_TIME_US = 49_989;

afterEach(cleanup);

const renderOperationSummary = (
    linkStatus: ReportLinkMatchResult,
    rows: TypedPerfTableRow[] = [],
    hasDeviceOperations = true,
    hasPerformanceReport = false,
) =>
    render(
        <OperationDevicePerfSummary
            linkStatus={linkStatus}
            hasPerformanceReport={hasPerformanceReport}
            hasDeviceOperations={hasDeviceOperations}
            rows={rows}
            totalDeviceTimeUs={REPORT_DEVICE_TIME_US}
        />,
    ).container;

describe('OperationDevicePerfSummary', () => {
    it('renders nothing while the reports are still being matched', () => {
        expect(renderOperationSummary(ReportLinkMatchResult.PENDING)).toBeEmptyDOMElement();
    });

    it('asks for a performance report when none is loaded', () => {
        renderOperationSummary(ReportLinkMatchResult.UNAVAILABLE);

        expect(screen.getByText(/Load a performance report from the same run/)).toBeInTheDocument();
    });

    it('says the device times could not be loaded when a selected report failed to read', () => {
        renderOperationSummary(ReportLinkMatchResult.UNAVAILABLE, [], true, true);

        expect(screen.getByText(/Device times could not be loaded/)).toBeInTheDocument();
        expect(screen.queryByText(/Load a performance report/)).not.toBeInTheDocument();
    });

    it('says when the loaded report does not match the memory report', () => {
        renderOperationSummary(ReportLinkMatchResult.UNLINKED);

        expect(screen.getByText(/does not match this memory report/)).toBeInTheDocument();
    });

    it.each([ReportLinkMatchResult.UNAVAILABLE, ReportLinkMatchResult.UNLINKED, ReportLinkMatchResult.LINKED])(
        'says nothing for an operation with no device operation, when the link is %s',
        (linkStatus) => {
            expect(renderOperationSummary(linkStatus, [accumulation], false)).toBeEmptyDOMElement();
        },
    );

    it('renders nothing for a linked operation with no device operation rows', () => {
        expect(renderOperationSummary(ReportLinkMatchResult.LINKED)).toBeEmptyDOMElement();
    });

    it("gives one device operation's time and share, with no slowest to name", () => {
        const container = renderOperationSummary(ReportLinkMatchResult.LINKED, [accumulation]);

        expect(container).toHaveTextContent("1 device operation ran for 116 µs (0.2% of the report's device time).");
        expect(container).not.toHaveTextContent('Slowest');
    });

    it('totals several device operations and names the slowest', () => {
        const container = renderOperationSummary(ReportLinkMatchResult.LINKED, [
            firstPermute,
            accumulation,
            secondPermute,
        ]);

        expect(container).toHaveTextContent(
            "3 device operations ran for 136 µs (0.3% of the report's device time). " +
                'Slowest: AccumulationDeviceOperation, 116 µs on 1 core.',
        );
    });

    it('leaves a row with no device time out of the total and the slowest', () => {
        const container = renderOperationSummary(ReportLinkMatchResult.LINKED, [untimed, accumulation, firstPermute]);

        expect(container).toHaveTextContent(
            "2 device operations ran for 130 µs (0.3% of the report's device time). " +
                'Slowest: AccumulationDeviceOperation, 116 µs on 1 core.',
        );
    });
});

const renderDeviceSummary = (row: TypedPerfTableRow) =>
    render(
        <DeviceOperationPerfSummary
            row={row}
            totalDeviceTimeUs={REPORT_DEVICE_TIME_US}
        />,
    ).container;

const openDetails = async (container: HTMLElement) => {
    fireEvent.mouseEnter(container.querySelector('.device-operation-perf')!);

    return screen.findByText(/Performance report row/);
};

describe('DeviceOperationPerfSummary', () => {
    it("shows device time, cores and share of the report's device time", () => {
        expect(renderDeviceSummary(accumulation)).toHaveTextContent('116 µs·1 core·0.2% of device time');
    });

    it('drops a part the row has no value for, separator included', () => {
        expect(renderDeviceSummary(untimed).querySelector('.device-operation-perf')).toHaveTextContent(/^64 cores$/);
    });

    it('marks a share too small to round as below a tenth of a percent', () => {
        expect(renderDeviceSummary(firstPermute)).toHaveTextContent('14 µs·64 cores·<0.1% of device time');
    });

    it('opens the whole perf row on hover, leaving out a column the row has no value for', async () => {
        const heading = await openDetails(renderDeviceSummary(accumulation));

        expect(heading).toHaveTextContent('Performance report row 6');
        expect(screen.getByText('Op-to-Op Gap')).toBeInTheDocument();
        expect(screen.getByText('Math Fidelity')).toBeInTheDocument();
        expect(screen.queryByText('Kernel Duration')).not.toBeInTheDocument();
    });

    it("writes out once why an unanalysed op's roofline cells are empty", async () => {
        await openDetails(renderDeviceSummary(accumulation));

        expect(
            screen.getByText(`Bound, DRAM, DRAM %, FLOPS, FLOPS %: n/a. ${NOT_MODELLED_REASON}`),
        ).toBeInTheDocument();
        expect(screen.queryByText('DRAM %')).not.toBeInTheDocument();
    });

    it('writes out what a SLOW bound means', async () => {
        const slowMatmul = typedRow({
            id: '24',
            raw_op_code: 'MatmulDeviceOperation',
            bound: 'SLOW' as PerfTableRow['bound'],
            bound_analysis: 'full',
            dram: '22.8',
            dram_percent: '7.9',
            flops: '17.5',
            flops_percent: '35.6',
        });

        await openDetails(renderDeviceSummary(slowMatmul));

        expect(screen.getByText(`Bound: ${SLOW_BOUND_REASON}`)).toBeInTheDocument();
        expect(screen.getByText('DRAM %')).toBeInTheDocument();
    });
});
