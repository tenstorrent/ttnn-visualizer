// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { Classes } from '@blueprintjs/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StackedPerformanceTable from '../src/components/performance/StackedPerfTable';
import { StackedColumnKeys, TypedStackedPerfRow } from '../src/definitions/StackedPerfTable';
import { TEST_IDS } from '../src/definitions/TestIds';
import { useGetNPEManifest, usePerfMeta } from '../src/hooks/useAPI';
import { TestProviders } from './helpers/TestProviders';
import { focusTooltipTarget } from './helpers/focusTooltipTarget';
import { DEFAULT_MAX_CORES } from '../src/functions/getCoreCount';
import { PERF_FOOTER_ALL_DEVICES_NOTE } from '../src/components/performance/PerfFooterPercent';
import { mergeDevicesAtom } from '../src/store/app';

vi.mock('../src/hooks/useAPI.tsx', () => ({
    useGetNPEManifest: vi.fn(),
    usePerfMeta: vi.fn(),
}));

const stackedRow = (
    opCode: string,
    {
        percent = 100,
        deviceTimeUs = 1,
        device = 0,
    }: { percent?: number | null; deviceTimeUs?: number; device?: number } = {},
): TypedStackedPerfRow =>
    ({
        [StackedColumnKeys.Percent]: percent,
        [StackedColumnKeys.OpCode]: opCode,
        [StackedColumnKeys.Device]: device,
        [StackedColumnKeys.DeviceTimeSumUs]: deviceTimeUs,
        [StackedColumnKeys.OpsCount]: 1,
    }) as unknown as TypedStackedPerfRow;

interface RenderOptions {
    stackedData?: TypedStackedPerfRow[];
    isLoading?: boolean;
    totalDeviceTimeUs?: number;
    mergeDevices?: boolean;
}

function renderStacked({
    stackedData = [],
    isLoading = false,
    totalDeviceTimeUs = 0,
    mergeDevices = true,
}: RenderOptions = {}) {
    return render(
        <TestProviders initialAtomValues={[[mergeDevicesAtom, mergeDevices]]}>
            <StackedPerformanceTable
                stackedData={stackedData}
                stackedComparisonData={[]}
                filters={null}
                reportFolderName='unit-test'
                maxCores={DEFAULT_MAX_CORES}
                isLoading={isLoading}
                totalDeviceTimeUs={totalDeviceTimeUs}
            />
        </TestProviders>,
    );
}

afterEach(cleanup);

beforeEach(() => {
    (useGetNPEManifest as Mock).mockReturnValue({ data: [], error: null });
    (usePerfMeta as Mock).mockReturnValue({ data: null, isLoading: false });
});

describe('StackedPerformanceTable loading state', () => {
    it('renders the skeleton instead of data rows while loading', () => {
        renderStacked({ stackedData: [stackedRow('Matmul')], isLoading: true });

        const skeleton = screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON);
        expect(skeleton).toBeInTheDocument();
        expect(skeleton).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByText('Matmul')).not.toBeInTheDocument();
    });

    it('keeps the device-architecture strip mounted while loading (scoped skeleton)', () => {
        renderStacked({ isLoading: true });

        expect(screen.getByTestId(TEST_IDS.PERF_TABLE_SKELETON)).toBeInTheDocument();
        expect(screen.getByText('Arch:')).toBeInTheDocument();
    });

    it('shows the empty state rather than the skeleton when not loading and there are no rows', () => {
        renderStacked();

        expect(screen.queryByTestId(TEST_IDS.PERF_TABLE_SKELETON)).toBeNull();
        expect(screen.getByText('No data to display')).toBeInTheDocument();
    });
});

describe('StackedPerformanceTable layout', () => {
    it('renders the table inside the scroll region the sticky header pins to', () => {
        renderStacked({ stackedData: [stackedRow('Matmul')] });

        const region = screen.getByRole('region', { name: 'Performance table' });
        expect(region).toHaveClass('perf-table-scroll');
        expect(within(region).getByRole('table').querySelector('thead')).toHaveClass('table-header');
    });
});

describe('StackedPerformanceTable footer', () => {
    const getTotalPercent = () => document.querySelector('tfoot td')?.textContent;

    it.each([
        [
            'every row',
            [
                stackedRow('Matmul', { percent: 75, deviceTimeUs: 75 }),
                stackedRow('Conv2d', { percent: 25, deviceTimeUs: 25 }),
            ],
            100,
            '100%',
        ],
        ['only the rows a filter leaves', [stackedRow('Conv2d', { percent: 25, deviceTimeUs: 25 })], 100, '25%'],
        ['rows with no device time', [stackedRow('Matmul', { percent: null, deviceTimeUs: 0 })], 0, '0%'],
        [
            // The CSV rounds each `%`; device time does not drift, where these would sum to 99.99%.
            'rows whose rounded percentages fall short of 100',
            [1, 1, 1].map((_, index) => stackedRow(`Op${index}`, { percent: 33.33, deviceTimeUs: 1 })),
            3,
            '100%',
        ],
        [
            // tt-perf-report gives each unmerged row its share of its own device: these sum to 200.
            'rows of two unmerged devices',
            [stackedRow('Matmul', { device: 0 }), stackedRow('Matmul', { device: 1 })],
            2,
            '100%',
        ],
    ])('totals Total %% over %s', (_, stackedData, totalDeviceTimeUs, expected) => {
        renderStacked({ stackedData, totalDeviceTimeUs });

        expect(getTotalPercent()).toBe(expected);
    });

    it("marks Total % as a share of all devices' time while devices are unmerged", async () => {
        renderStacked({
            stackedData: [stackedRow('Matmul', { device: 0 }), stackedRow('Matmul', { device: 1 })],
            totalDeviceTimeUs: 2,
            mergeDevices: false,
        });
        const percent = document.querySelector(`tfoot .${Classes.TOOLTIP_INDICATOR}`) as HTMLElement;

        expect(percent).toHaveTextContent('100%');
        focusTooltipTarget(percent);
        expect(await screen.findByText(PERF_FOOTER_ALL_DEVICES_NOTE)).toBeInTheDocument();
    });

    it('leaves Total % unmarked while devices are merged', () => {
        renderStacked({ stackedData: [stackedRow('Matmul')], totalDeviceTimeUs: 1 });

        expect(document.querySelector(`tfoot .${Classes.TOOLTIP_INDICATOR}`)).toBeNull();
    });
});
