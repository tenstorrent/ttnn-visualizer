// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PerformanceChartsTab from '../src/components/performance/PerformanceChartsTab';
import { EventLogEvent, PerfChartLabel } from '../src/definitions/EventLogEvent';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';

// The real scroll-spy, unlike PerfSurfaceEvents.spec.tsx: what is pinned here is that the tab
// counts the chart it opens on without any scrolling.
const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));
vi.mock('../src/hooks/usePrefilterPerfTableByOpCode', () => ({ usePrefilterPerfTableByOpCode: () => vi.fn() }));
vi.mock('../src/components/performance/PerfCharts', () => ({ default: () => null }));
vi.mock('../src/components/performance/NonFilterablePerfCharts', () => ({ default: () => null }));
vi.mock('../src/components/performance/PerfChartsIndex', () => ({ default: () => null }));
vi.mock('../src/components/performance/PerfChartFilter', () => ({ default: () => null }));

const tab = () => (
    <PerformanceChartsTab
        filteredPerfData={[]}
        enrichedData={[]}
        selectedOpCodes={[]}
        opCodeOptions={[]}
        updateOpCodes={vi.fn()}
    />
);

beforeEach(() => {
    recordEvent.mockClear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
});

describe('PerformanceChartsTab on arrival', () => {
    it('records the chart the tab opens on, once, without scrolling', () => {
        const { rerender } = render(<TestProviders>{tab()}</TestProviders>);

        rerender(<TestProviders>{tab()}</TestProviders>);

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.PERF_CHART_VIEWED,
            details: { perf_chart: PerfChartLabel.OP_DURATION_HISTOGRAM },
        });
    });

    it('records only the chart it opens on when a comparison report is present from mount', () => {
        render(
            <TestProviders
                initialAtomValues={[
                    [activePerformanceReportAtom, { path: 'report-a', reportName: 'report-a' }],
                    [comparisonPerformanceReportListAtom, ['report-b']],
                ]}
            >
                {tab()}
            </TestProviders>,
        );

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.PERF_CHART_VIEWED,
            details: { perf_chart: PerfChartLabel.OP_DURATION_HISTOGRAM },
        });
    });
});

describe('PerformanceChartsTab at the bottom of the page', () => {
    const VIEWPORT_HEIGHT_PX = 800;
    const PAGE_HEIGHT_PX = 2000;

    it('records the charts in view but never a matmul or conv placeholder', () => {
        // Every id resolves to a rendered section near the bottom of the viewport, the matmul and
        // conv placeholders included, so only the tab's list of charts can keep them out.
        vi.spyOn(document, 'getElementById').mockImplementation(() => {
            const element = document.createElement('div');

            Object.defineProperty(element, 'offsetHeight', { configurable: true, value: 100 });
            vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 600, height: 100 } as DOMRect);

            return element;
        });
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT_PX);
        vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(PAGE_HEIGHT_PX);
        Object.defineProperty(window, 'scrollY', {
            configurable: true,
            value: PAGE_HEIGHT_PX - VIEWPORT_HEIGHT_PX,
            writable: true,
        });

        render(<TestProviders>{tab()}</TestProviders>);
        act(() => {
            window.dispatchEvent(new Event('scroll'));
        });

        const recordedCharts = recordEvent.mock.calls.map(([event]) => event.details.perf_chart);

        expect(recordedCharts).toEqual([
            PerfChartLabel.OP_DURATION_HISTOGRAM,
            PerfChartLabel.OP_COUNT_VS_RUNTIME,
            PerfChartLabel.CORE_COUNT_KERNEL_RUNTIME,
            PerfChartLabel.KERNEL_DURATION_VS_CORE_COUNT,
        ]);
    });
});
