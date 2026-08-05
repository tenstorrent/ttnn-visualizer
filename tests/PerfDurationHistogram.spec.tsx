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
import { TEST_IDS } from '../src/definitions/TestIds';
import { MarkerColours, TypedPerfTableRow } from '../src/definitions/PerfTable';
import { durationBucketFilterListAtom, perfSelectedTabAtom } from '../src/store/app';
import { AtomProviderInitialValues } from './helpers/atomProvider';
import { TestProviders } from './helpers/TestProviders';

type HistogramTrace = {
    name?: string;
    type?: string;
    customdata?: unknown;
    marker?: { color?: string };
    y?: number[];
};

const getHintText = () =>
    screen.queryAllByTestId(TEST_IDS.PERF_CHART_TABLE_FILTER_HINT).map((hint) => hint.textContent);

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
    const clickBucket = (index: number) => act(() => firePlotAnnotationClick(index));

    // The tab swap scrolls the new panel to the top, which jsdom does not implement
    beforeEach(() => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
            callback(0);
            return 0;
        });
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('draws one clickable annotation per histogram column, labelled with its range', () => {
        renderHistogram();

        const annotations = getAnnotations();
        expect(annotations).toHaveLength(2);
        expect(annotations.every((annotation) => annotation.captureevents === true)).toBe(true);
        expect(annotations.every((annotation) => Boolean(annotation.text))).toBe(true);
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
    });

    it('fills in buckets already held in the filter', () => {
        renderHistogram([1]);

        expect(getSelectedFlags()).toEqual([true, false]);
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
    });

    it('ignores a click on an annotation index with no matching bucket', () => {
        renderHistogram();

        clickBucket(99);

        expect(getSelectedFlags()).toEqual([false, false]);
        expect(screen.getByTestId('selected-tab')).toHaveTextContent(PerfTabIds.CHARTS);
    });
});
