// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
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

afterEach(cleanup);

describe('PerformanceChartsTab on arrival', () => {
    it('records the chart the tab opens on, once, without scrolling', () => {
        const { rerender } = render(<TestProviders>{tab()}</TestProviders>);

        rerender(<TestProviders>{tab()}</TestProviders>);

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.PERF_CHART_VIEWED,
            details: { perf_chart: PerfChartLabel.OP_DURATION_HISTOGRAM },
        });
    });

    it('records no further chart when a comparison report adds sections', () => {
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
