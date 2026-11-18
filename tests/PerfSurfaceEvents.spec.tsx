// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    activeSection: { id: null as string | null, inViewAtBottom: [] as string[] },
}));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

// The scroll-spy is covered by its own spec; here it is the input the tab reacts to.
vi.mock('../src/hooks/useScrollSpy', () => ({
    useScrollSpy: () => ({
        activeId: activeSection.id,
        // The hook lists the active section among those in view, after any it finds at the bottom.
        sectionsInView: [
            ...new Set([...activeSection.inViewAtBottom, ...(activeSection.id ? [activeSection.id] : [])]),
        ],
    }),
}));

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
    // A fresh element each time: React skips a rerender handed the very same element.
    const tree = () => (
        <TestProviders>
            <ChartsTab />
        </TestProviders>
    );
    const view = render(tree());

    const showSection = (id: string, inViewAtBottom: string[] = []) => {
        activeSection.id = id;
        activeSection.inViewAtBottom = inViewAtBottom;
        view.rerender(tree());
    };

    return { ...view, showSection };
}

beforeEach(() => {
    recordEvent.mockClear();
    activeSection.id = null;
    activeSection.inViewAtBottom = [];
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

        // Charts every report has, so the tab could show them with the empty data it is given.
        showSection(PerfChartId.OpCountVsRuntime);
        showSection(PerfChartId.OpDurationHistogram);
        showSection(PerfChartId.OpCountVsRuntime);

        expect(recordEvent.mock.calls).toEqual([
            [chartViewed(PerfChartLabel.OP_DURATION_HISTOGRAM)],
            [chartViewed(PerfChartLabel.OP_COUNT_VS_RUNTIME)],
        ]);
    });

    it('records every chart in view at the bottom of the page, each once', () => {
        activeSection.id = PerfChartId.OpDurationHistogram;
        const { showSection } = renderChartsTab();

        showSection(PerfChartId.KernelDurationVsCoreCount, [
            PerfChartId.CoreCountKernelRuntime,
            PerfChartId.KernelDurationVsCoreCount,
        ]);
        showSection(PerfChartId.KernelDurationVsCoreCount, [PerfChartId.KernelDurationVsCoreCount]);

        expect(recordEvent.mock.calls).toEqual([
            [chartViewed(PerfChartLabel.OP_DURATION_HISTOGRAM)],
            [chartViewed(PerfChartLabel.CORE_COUNT_KERNEL_RUNTIME)],
            [chartViewed(PerfChartLabel.KERNEL_DURATION_VS_CORE_COUNT)],
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
        // Replacing the report in a slot is a use too, and leaves the count as it was.
        [['report-c'], 0, ComparisonReportCountBucket.ONE],
    ])('buckets a pick into %j at %i by the resulting count', (comparisonReports, reportIndex, bucket) => {
        renderSelector(comparisonReports, reportIndex);

        fireEvent.click(screen.getByRole('button', { name: 'Pick report' }));

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith({
            event: EventLogEvent.PERF_COMPARISON_USED,
            details: { report_count_bucket: bucket },
        });
    });

    it('records nothing when a comparison report is removed', () => {
        renderSelector(['report-c'], 0);

        fireEvent.click(screen.getByRole('button', { name: 'Remove report' }));

        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('records nothing when the report already in the slot is picked again', () => {
        renderSelector([PICKED_FOLDER.reportName], 0);

        fireEvent.click(screen.getByRole('button', { name: 'Pick report' }));

        expect(recordEvent).not.toHaveBeenCalled();
    });
});
