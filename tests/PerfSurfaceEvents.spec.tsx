// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PerformanceChartsTab from '../src/components/performance/PerformanceChartsTab';
import ComparisonReportSelector from '../src/components/performance/ComparisonReportSelector';
import { ComparisonReportCountBucket, EventLogEvent, PerfChartLabel } from '../src/definitions/EventLogEvent';
import { PerfChartId } from '../src/definitions/PerformanceCharts';
import { ReportFolder } from '../src/definitions/Reports';
import { activePerformanceReportAtom, comparisonPerformanceReportListAtom } from '../src/store/app';
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { TestProviders } from './helpers/TestProviders';

const { recordEvent, activeSection } = vi.hoisted(() => ({
    recordEvent: vi.fn(),
    activeSection: { id: null as string | null },
}));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

// The scroll-spy is covered by its own spec; here it is the input the tab reacts to.
vi.mock('../src/hooks/useActiveSection', () => ({ useActiveSection: () => activeSection.id }));

vi.mock('../src/hooks/usePrefilterPerfTableByOpCode', () => ({ usePrefilterPerfTableByOpCode: () => vi.fn() }));

// The charts themselves render Plotly; only the tab's own behaviour is under test.
vi.mock('../src/components/performance/PerfCharts', () => ({ default: () => null }));
vi.mock('../src/components/performance/NonFilterablePerfCharts', () => ({ default: () => null }));
vi.mock('../src/components/performance/PerfChartsIndex', () => ({ default: () => null }));
vi.mock('../src/components/performance/PerfChartFilter', () => ({ default: () => null }));

const PICKED_FOLDER: ReportFolder = { path: 'report-b', reportName: 'report-b' };

// Stands in for the folder picker: one click selects a fixed folder through the real handler.
vi.mock('../src/components/report-selection/LocalFolderPicker', () => ({
    default: ({ handleSelect }: { handleSelect: (folder: ReportFolder) => void }) => (
        <button
            type='button'
            onClick={() => handleSelect(PICKED_FOLDER)}
        >
            Pick report
        </button>
    ),
}));

const chartViewed = (chart: PerfChartLabel) => ({
    event: EventLogEvent.PERF_CHART_VIEWED,
    details: { perf_chart: chart },
});

function ChartsTab() {
    return (
        <PerformanceChartsTab
            filteredPerfData={[]}
            enrichedData={[]}
            selectedOpCodes={[]}
            opCodeOptions={[]}
            updateOpCodes={vi.fn()}
        />
    );
}

function renderChartsTab() {
    const view = render(
        <TestProviders>
            <ChartsTab />
        </TestProviders>,
    );

    const showSection = (id: string) => {
        activeSection.id = id;
        view.rerender(
            <TestProviders>
                <ChartsTab />
            </TestProviders>,
        );
    };

    return { ...view, showSection };
}

beforeEach(() => {
    recordEvent.mockClear();
    activeSection.id = null;
});

afterEach(cleanup);

describe('PerformanceChartsTab usage events', () => {
    it('records the chart the tab opens on', () => {
        activeSection.id = PerfChartId.OpDurationHistogram;

        renderChartsTab();

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(chartViewed(PerfChartLabel.OP_DURATION_HISTOGRAM));
    });

    it('records each chart once per visit however often it is scrolled past', () => {
        activeSection.id = PerfChartId.OpDurationHistogram;
        const { showSection } = renderChartsTab();

        showSection(PerfChartId.MatmulDeviceTime);
        showSection(PerfChartId.OpDurationHistogram);
        showSection(PerfChartId.MatmulDeviceTime);

        expect(recordEvent.mock.calls).toEqual([
            [chartViewed(PerfChartLabel.OP_DURATION_HISTOGRAM)],
            [chartViewed(PerfChartLabel.MATMUL_DEVICE_TIME)],
        ]);
    });

    it("counts each report's Operation Types section as one chart", () => {
        activeSection.id = `${PerfChartId.OperationTypes}-active`;
        const { showSection } = renderChartsTab();

        showSection(`${PerfChartId.OperationTypes}-comparison-0`);

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(chartViewed(PerfChartLabel.OPERATION_TYPES));
    });

    it('records the charts again on a later visit to the tab', () => {
        activeSection.id = PerfChartId.OpDurationHistogram;
        const { unmount } = renderChartsTab();

        unmount();
        renderChartsTab();

        expect(recordEvent).toHaveBeenCalledTimes(2);
    });

    it('records nothing while no section is active', () => {
        renderChartsTab();

        expect(recordEvent).not.toHaveBeenCalled();
    });
});

describe('ComparisonReportSelector usage events', () => {
    function renderSelector(comparisonReports: string[] | null, reportIndex: number) {
        const initialAtomValues: AtomProviderInitialValues = [
            [activePerformanceReportAtom, { path: 'report-a', reportName: 'report-a' }],
        ];

        if (comparisonReports) {
            initialAtomValues.push([comparisonPerformanceReportListAtom, comparisonReports]);
        }

        return render(
            <TestProviders initialAtomValues={initialAtomValues}>
                <ComparisonReportSelector
                    folderList={[PICKED_FOLDER]}
                    reportIndex={reportIndex}
                    label='Compare'
                />
            </TestProviders>,
        );
    }

    it.each([
        [null, 0, ComparisonReportCountBucket.ONE],
        [['report-c'], 1, ComparisonReportCountBucket.TWO],
        [['report-c', 'report-d'], 2, ComparisonReportCountBucket.THREE_OR_MORE],
    ])('buckets an add to %j by the resulting count', (comparisonReports, reportIndex, bucket) => {
        renderSelector(comparisonReports, reportIndex);

        fireEvent.click(screen.getByRole('button', { name: 'Pick report' }));

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.PERF_COMPARISON_USED,
            details: { report_count_bucket: bucket },
        });
    });

    it('records nothing when a comparison report is removed', () => {
        renderSelector(['report-c'], 0);

        act(() => {
            fireEvent.click(screen.getByRole('button', { name: 'Remove report' }));
        });

        expect(recordEvent).not.toHaveBeenCalled();
    });
});
