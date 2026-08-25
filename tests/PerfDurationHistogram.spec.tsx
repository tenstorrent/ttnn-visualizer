// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { Annotations } from 'plotly.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    firePlotAnnotationClick,
    firePlotClick,
    getLatestPlotLayout,
    getPlotInstances,
    resetPlotPropsCapture,
} from './mocks/plotComponent';
import PerfDurationHistogram from '../src/components/performance/PerfDurationHistogram';
import {
    MAX_LEGEND_OP_CODES,
    OTHER_OP_CODE_COLOUR,
    OTHER_OP_CODE_LABEL,
    PERF_DURATION_BUCKET_FILTER_HINT,
    PERF_DURATION_HISTOGRAM_ACTIVE_REPORT_SUBTITLE,
    PERF_DURATION_HISTOGRAM_EMPTY_MESSAGE,
} from '../src/definitions/PerfDurationHistogram';
import { OpType, PerfTabIds } from '../src/definitions/Performance';
import { PERF_CHART_TABLE_FILTER_HINT, PerfChartId } from '../src/definitions/PerformanceCharts';
import { PERF_CHART_TRANSPARENT } from '../src/definitions/PlotConfigurations';
import { formatDurationBucketRange } from '../src/functions/formatDurationBucketRange';
import { TEST_IDS } from '../src/definitions/TestIds';
import { MarkerColours } from '../src/definitions/PerfTable';
import { TypedPerfTableRow } from '../src/model/PerfTable';
import { durationBucketFilterListAtom, perfSelectedTabAtom } from '../src/store/app';
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { setUpScrollResetMocks } from './helpers/mockScrollReset';
import { TestProviders } from './helpers/TestProviders';

type HistogramTrace = {
    name?: string;
    type?: string;
    customdata?: unknown;
    marker?: { color?: string };
    x?: string[];
    y?: number[];
};

const getHintText = () => screen.queryAllByTestId(TEST_IDS.PERF_CHART_HINT).map((hint) => hint.textContent);

// Distinct stand-ins for the real theme tokens: jsdom applies no stylesheet, so without these
// every chrome colour resolves to '' and any assertion comparing two of them would hold vacuously.
const CHART_CHROME = {
    line: 'rgb(11, 11, 11)',
    text: 'rgb(22, 22, 22)',
    surface: 'rgb(33, 33, 33)',
};

const setUpChartChrome = () => {
    document.documentElement.style.setProperty('--perf-chart-line', CHART_CHROME.line);
    document.documentElement.style.setProperty('--perf-chart-text', CHART_CHROME.text);
    document.documentElement.style.setProperty('--perf-chart-surface', CHART_CHROME.surface);
};

const tearDownChartChrome = () => {
    document.documentElement.style.removeProperty('--perf-chart-line');
    document.documentElement.style.removeProperty('--perf-chart-text');
    document.documentElement.style.removeProperty('--perf-chart-surface');
};

const row = (overrides: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        id: 1,
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        device_time: 5,
        ...overrides,
    }) as TypedPerfTableRow;

afterEach(() => {
    cleanup();
    resetPlotPropsCapture();
});

describe('PerfDurationHistogram', () => {
    it('renders the histogram container and chart title', () => {
        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={[row()]}
                    selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                />
            </TestProviders>,
        );

        expect(screen.getByTestId(TEST_IDS.PERF_DURATION_HISTOGRAM)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Op Duration Distribution' })).toBeInTheDocument();
        expect(document.getElementById(PerfChartId.OpDurationHistogram)).toBeInTheDocument();
    });

    it('keeps the chart anchor id when there are no eligible ops', () => {
        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={[row({ device_time: 0 })]}
                    selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                />
            </TestProviders>,
        );

        expect(screen.getByTestId(TEST_IDS.PERF_DURATION_HISTOGRAM)).toBeInTheDocument();
        expect(document.getElementById(PerfChartId.OpDurationHistogram)).toBeInTheDocument();
        expect(screen.getByText(PERF_DURATION_HISTOGRAM_EMPTY_MESSAGE)).toBeInTheDocument();
    });

    it('documents single-report scope when comparison reports are present', () => {
        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={[row()]}
                    selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                    hasComparisonReports
                />
            </TestProviders>,
        );

        expect(screen.getByText(PERF_DURATION_HISTOGRAM_ACTIVE_REPORT_SUBTITLE)).toBeInTheDocument();
    });

    it('builds stacked bar traces with tuple customdata per point', () => {
        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={[
                        row({ raw_op_code: 'Matmul', op_code: 'Matmul', device_time: 5 }),
                        row({ raw_op_code: 'Conv2d', op_code: 'Conv2d', device_time: 6 }),
                    ]}
                    selectedOpCodes={[
                        { opCode: 'Matmul', colour: MarkerColours[0] },
                        { opCode: 'Conv2d', colour: MarkerColours[1] },
                    ]}
                    onOpCodeClick={vi.fn()}
                />
            </TestProviders>,
        );

        const traces = getPlotInstances()[0]?.data as HistogramTrace[] | undefined;
        expect(traces?.length).toBe(2);
        expect(traces?.every((trace) => trace.type === 'bar')).toBe(true);

        for (const trace of traces ?? []) {
            expect(Array.isArray(trace.customdata)).toBe(true);
            const point = (trace.customdata as [string, number, string][])[0];
            expect(point).toHaveLength(3);
            expect(['Matmul', 'Conv2d']).toContain(point[0]);
            expect(typeof point[1]).toBe('number');
            expect(typeof point[2]).toBe('string');
        }
    });

    it('calls onOpCodeClick with raw op code from tuple customdata', () => {
        const onOpCodeClick = vi.fn();

        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={[row({ raw_op_code: 'Matmul', device_time: 5 })]}
                    selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                    onOpCodeClick={onOpCodeClick}
                />
            </TestProviders>,
        );

        firePlotClick({ points: [{ customdata: ['Matmul', 1, 'Matmul'] }] } as never);

        expect(onOpCodeClick).toHaveBeenCalledWith('Matmul');
    });

    it('does not wire plot onClick when onOpCodeClick is omitted', () => {
        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={[row()]}
                    selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                />
            </TestProviders>,
        );

        // The bucket controls stay clickable, so a hint remains — minus the op code guidance
        expect(getHintText()).toEqual([PERF_DURATION_BUCKET_FILTER_HINT]);
        expect(getPlotInstances()[0]?.onClick).toBeUndefined();
    });

    it('lists the op code and bucket guidance as separate hints when both apply', () => {
        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={[row()]}
                    selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                    onOpCodeClick={vi.fn()}
                />
            </TestProviders>,
        );

        expect(getHintText()).toEqual([PERF_CHART_TABLE_FILTER_HINT, PERF_DURATION_BUCKET_FILTER_HINT]);
    });

    it('rolls overflow op codes into Other and does not filter on Other clicks', () => {
        const onOpCodeClick = vi.fn();
        const opCodes = Array.from({ length: MAX_LEGEND_OP_CODES + 3 }, (_, index) => `Op${index}`);
        const rows = opCodes.map((rawOpCode, index) =>
            row({
                id: index + 1,
                raw_op_code: rawOpCode,
                op_code: rawOpCode,
                device_time: 5,
            }),
        );
        const selectedOpCodes = opCodes.map((opCode, index) => ({
            opCode,
            colour: MarkerColours[index % MarkerColours.length],
        }));

        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={rows}
                    selectedOpCodes={selectedOpCodes}
                    onOpCodeClick={onOpCodeClick}
                />
            </TestProviders>,
        );

        const traces = getPlotInstances()[0]?.data as HistogramTrace[] | undefined;
        expect(traces).toHaveLength(MAX_LEGEND_OP_CODES);

        const otherTrace = traces?.find((trace) => trace.name === OTHER_OP_CODE_LABEL);
        expect(otherTrace).toBeDefined();
        expect(otherTrace?.marker?.color).toBe(OTHER_OP_CODE_COLOUR);

        const otherPoint = (otherTrace?.customdata as [string, number, string][])[0];
        expect(otherPoint[0]).toBe('');
        expect((otherTrace?.y ?? []).reduce((sum, value) => sum + value, 0)).toBe(4);

        firePlotClick({ points: [{ customdata: otherPoint }] } as never);
        expect(onOpCodeClick).not.toHaveBeenCalled();
    });
});

describe('PerfDurationHistogram duration bucket controls', () => {
    // 5us and 50us straddle a decade boundary, so the histogram spans exactly two buckets
    const twoBucketRows = [row({ device_time: 5 }), row({ device_time: 50, id: 2 })];

    function SelectedTabProbe() {
        return <span data-testid='selected-tab'>{String(useAtomValue(perfSelectedTabAtom))}</span>;
    }

    const renderHistogram = (selectedBuckets: number[] = []) => {
        const initialAtomValues: AtomProviderInitialValues = [[perfSelectedTabAtom, PerfTabIds.CHARTS]];

        if (selectedBuckets.length > 0) {
            initialAtomValues.push([durationBucketFilterListAtom, selectedBuckets]);
        }

        return render(
            <TestProviders initialAtomValues={initialAtomValues}>
                <PerfDurationHistogram
                    rows={twoBucketRows}
                    selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                />
                <SelectedTabProbe />
            </TestProviders>,
        );
    };

    const getAnnotations = () => (getLatestPlotLayout()?.annotations ?? []) as Partial<Annotations>[];

    const getSelectedFlags = () => getAnnotations().map((annotation) => annotation.bgcolor !== PERF_CHART_TRANSPARENT);

    // Plotly calls the handler outside React's event system, so the re-render needs flushing
    const clickBucket = (index: number, mouseEvent: Partial<MouseEvent> = {}) =>
        act(() => firePlotAnnotationClick(index, mouseEvent));

    beforeEach(() => {
        setUpScrollResetMocks();
        setUpChartChrome();
    });

    afterEach(() => {
        tearDownChartChrome();
        vi.restoreAllMocks();
    });

    it('draws one clickable annotation per histogram column, labelled with its range', () => {
        renderHistogram();

        const annotations = getAnnotations();
        expect(annotations).toHaveLength(2);
        expect(annotations.every((annotation) => annotation.captureevents === true)).toBe(true);
        // The x tick labels are switched off, so these carry the only range labelling in the chart
        expect(annotations.map((annotation) => annotation.text)).toEqual([
            formatDurationBucketRange(1, 10),
            formatDurationBucketRange(10, 100),
        ]);
    });

    it('anchors each control over its column by paper fraction, centred', () => {
        renderHistogram();

        const traceCategories = (getPlotInstances()[0]?.data as HistogramTrace[])[0]?.x;
        expect(traceCategories).toEqual([formatDurationBucketRange(1, 10), formatDurationBucketRange(10, 100)]);

        // Anchored to the plotting area by fraction, not to the x axis: an axis-referenced x is
        // resolved against a stale category range when react-plotly redraws a single re-styled
        // annotation, jumping the selected control sideways (#1868). Hardcoded rather than recomputed
        // from the implementation's own expression, which could only ever agree with itself.
        expect(getAnnotations().map((annotation) => annotation.x)).toEqual([0.25, 0.75]);
        expect(getAnnotations().every((annotation) => annotation.xref === 'paper')).toBe(true);
        expect(getAnnotations().every((annotation) => annotation.xanchor === 'center')).toBe(true);

        // The bug is a redraw artefact, so the fractions have to survive a selection change. A mocked
        // Plot under jsdom cannot reproduce the visual jump itself, only that the anchoring holds.
        clickBucket(0, { shiftKey: true });

        expect(getAnnotations().map((annotation) => annotation.x)).toEqual([0.25, 0.75]);
        expect(getAnnotations().every((annotation) => annotation.xanchor === 'center')).toBe(true);
    });

    it('explains the bucket controls in the chart hint rather than per-annotation hover text', () => {
        renderHistogram();

        expect(getHintText()).toContain(PERF_DURATION_BUCKET_FILTER_HINT);
        expect(getAnnotations().every((annotation) => annotation.hovertext === undefined)).toBe(true);
    });

    it('replaces the x tick labels rather than duplicating them', () => {
        renderHistogram();

        const xaxis = getLatestPlotLayout()?.xaxis as { showticklabels?: boolean } | undefined;
        expect(xaxis?.showticklabels).toBe(false);
    });

    it('draws no bucket annotations when there are no eligible ops', () => {
        render(
            <TestProviders>
                <PerfDurationHistogram
                    rows={[row({ device_time: 0 })]}
                    selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                />
            </TestProviders>,
        );

        expect(screen.getByText(PERF_DURATION_HISTOGRAM_EMPTY_MESSAGE)).toBeInTheDocument();
        expect(getPlotInstances()).toHaveLength(0);
        expect(getAnnotations()).toHaveLength(0);
    });

    it('fills in buckets already held in the filter', () => {
        renderHistogram([1]);

        expect(getSelectedFlags()).toEqual([true, false]);

        // Selection inverts fill, border and label, and the label must flip with the fill to stay legible
        const [selected, unselected] = getAnnotations();
        expect(selected.bgcolor).toBe(CHART_CHROME.text);
        expect(selected.bordercolor).toBe(CHART_CHROME.text);
        expect(selected.font?.color).toBe(CHART_CHROME.surface);
        expect(unselected.bgcolor).toBe(PERF_CHART_TRANSPARENT);
        expect(unselected.bordercolor).toBe(CHART_CHROME.line);
        expect(unselected.font?.color).toBe(CHART_CHROME.text);
    });

    it('filters to the clicked bucket and moves to the table tab', () => {
        renderHistogram();
        expect(getSelectedFlags()).toEqual([false, false]);

        clickBucket(0);

        expect(getSelectedFlags()).toEqual([true, false]);
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.TABLE);
    });

    it('replaces the previous selection rather than unioning with it', () => {
        renderHistogram([1]);

        clickBucket(1);

        expect(getSelectedFlags()).toEqual([false, true]);
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.TABLE);
    });

    it('collapses a multi-bucket selection onto the plain-clicked bucket', () => {
        renderHistogram([1, 10]);

        clickBucket(0);

        // The branch that separates replace from toggle: clicking one of two selected buckets is the
        // only case where "is this bucket selected?" and "is this the sole selection?" disagree.
        expect(getSelectedFlags()).toEqual([true, false]);
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.TABLE);
    });

    it('shift-clicks the last remaining bucket to clear the filter', () => {
        renderHistogram([10]);

        clickBucket(1, { shiftKey: true });

        expect(getSelectedFlags()).toEqual([false, false]);
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });

    it('shift-clicks to add a bucket without leaving the charts tab', () => {
        renderHistogram([1]);

        clickBucket(1, { shiftKey: true });

        expect(getSelectedFlags()).toEqual([true, true]);
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });

    it('shift-clicks a selected bucket to remove it without leaving the charts tab', () => {
        renderHistogram([1, 10]);

        clickBucket(0, { shiftKey: true });

        expect(getSelectedFlags()).toEqual([false, true]);
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });

    it('clears the filter when the sole selected control is clicked again', () => {
        renderHistogram([1]);

        clickBucket(0);

        expect(getSelectedFlags()).toEqual([false, false]);
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });

    it('ignores a click on an annotation index with no matching bucket', () => {
        renderHistogram();

        clickBucket(99);

        expect(getSelectedFlags()).toEqual([false, false]);
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });

    // The annotations are memoized for reference stability: PerfChart derives the Plotly layout
    // from them, and Plotly diffs layout by reference, so losing the identity redraws the whole
    // chart on every PerfReport render. Nothing else in this suite would notice.
    it('reuses the derived layout across a re-render with unchanged rows and op codes', () => {
        const selectedOpCodes = [{ opCode: 'Matmul', colour: MarkerColours[0] }];
        const tree = () => (
            <TestProviders initialAtomValues={[[perfSelectedTabAtom, PerfTabIds.CHARTS]]}>
                <PerfDurationHistogram
                    rows={twoBucketRows}
                    selectedOpCodes={selectedOpCodes}
                />
            </TestProviders>
        );

        const { rerender } = render(tree());
        rerender(tree());

        const [first, second] = getPlotInstances();
        expect(second).toBeDefined();
        expect(second.layout).toBe(first.layout);
        expect((second.layout as { annotations?: unknown }).annotations).toBe(
            (first.layout as { annotations?: unknown }).annotations,
        );
    });

    describe('empty columns', () => {
        // Decades run contiguously between 5us and 5000us, so the two middle columns hold no op
        const gappedRows = [row({ device_time: 5 }), row({ device_time: 5000, id: 2 })];

        const renderGappedHistogram = () =>
            render(
                <TestProviders initialAtomValues={[[perfSelectedTabAtom, PerfTabIds.CHARTS]]}>
                    <PerfDurationHistogram
                        rows={gappedRows}
                        selectedOpCodes={[{ opCode: 'Matmul', colour: MarkerColours[0] }]}
                    />
                    <SelectedTabProbe />
                </TestProviders>,
            );

        it('mutes the controls of the columns holding no op and stops them capturing clicks', () => {
            renderGappedHistogram();

            const annotations = getAnnotations();
            expect(annotations.map((annotation) => annotation.captureevents)).toEqual([true, false, false, true]);
            expect(annotations.map((annotation) => annotation.font?.color)).toEqual([
                CHART_CHROME.text,
                CHART_CHROME.line,
                CHART_CHROME.line,
                CHART_CHROME.text,
            ]);
        });

        it('does not filter on a click through an empty column, which would empty the table', () => {
            renderGappedHistogram();

            clickBucket(1);

            expect(getSelectedFlags()).toEqual([false, false, false, false]);
            expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
        });

        it('still filters on the populated columns either side of the gap', () => {
            renderGappedHistogram();

            clickBucket(3);

            expect(getSelectedFlags()).toEqual([false, false, false, true]);
            expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.TABLE);
        });
    });
});
