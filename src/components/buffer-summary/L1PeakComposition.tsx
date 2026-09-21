// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Callout, Intent, Tag } from '@blueprintjs/core';
import { useAtomValue } from 'jotai';
import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from '../../libs/PlotComponent';
import { L1PeakPrecision, L1ResidentKind } from '../../functions/l1PeakDecomposition';
import { formatMemorySize, prettyPrintAddress } from '../../functions/math';
import { showHexAtom } from '../../store/app';
import { L1_DEFAULT_MEMORY_SIZE } from '../../definitions/L1MemorySize';
import { L1_PEAK_COLORS } from '../../definitions/GraphColors';
import { getPerfChartChrome } from '../../definitions/PlotConfigurations';
import { useL1PeakDecomposition } from '../../hooks/useL1PeakDecomposition';
import 'styles/components/L1PeakComposition.scss';

const TOP_OPERATION_COUNT = 10;

const SERIES = [
    { key: 'circularBufferBytes', label: 'Circular buffers', colour: L1_PEAK_COLORS.circularBuffer },
    { key: 'intermediateTensorBytes', label: 'Intermediate tensors', colour: L1_PEAK_COLORS.intermediateTensor },
    { key: 'persistentTensorBytes', label: 'Persistent tensors', colour: L1_PEAK_COLORS.persistentTensor },
    { key: 'staleTensorBytes', label: 'Stale tensors', colour: L1_PEAK_COLORS.staleTensor },
] as const;

const KIND_LABEL: Record<L1ResidentKind, string> = {
    [L1ResidentKind.CircularBuffer]: 'Circular buffer',
    [L1ResidentKind.IntermediateTensor]: 'Intermediate',
    [L1ResidentKind.PersistentTensor]: 'Persistent',
    [L1ResidentKind.StaleTensor]: 'Stale',
};

function L1PeakComposition() {
    const { result, isLoading } = useL1PeakDecomposition();
    // Same address presentation as the memory legends, including the hex preference. #2025
    const showHex = useAtomValue(showHexAtom);
    // Resolved on use, not at import: these read from the stylesheet, which may not have
    // applied when the module first evaluates.
    const chrome = getPerfChartChrome();

    const ordered = useMemo(
        () => [...result.byOperationId.values()].sort((left, right) => left.operationId - right.operationId),
        [result],
    );

    const topOperations = useMemo(
        () => [...ordered].sort((left, right) => right.totalBytes - left.totalBytes).slice(0, TOP_OPERATION_COUNT),
        [ordered],
    );

    const chartData = useMemo<Partial<PlotData>[]>(() => {
        const x = ordered.map((entry) => entry.operationId);

        return SERIES.map(({ key, label, colour }) => ({
            x,
            y: ordered.map((entry) => entry[key]),
            type: 'scatter',
            mode: 'lines',
            stackgroup: 'l1',
            name: label,
            line: { width: 0, color: colour },
            fillcolor: colour,
            // Unified hover below, so the trace name is the row label and the box already
            // carries the operation. Repeating either would print it four times.
            hovertemplate: `%{y:,} B<extra>${label}</extra>`,
        }));
    }, [ordered]);

    if (isLoading) {
        return <p className='l1-peak-empty'>Replaying captured graphs…</p>;
    }

    if (result.peak === null) {
        return <p className='l1-peak-empty'>This report records no L1 activity.</p>;
    }

    const { peak, capacityBytes, exceedsCapacity } = result;
    const percentOfCapacity = capacityBytes ? Math.round((peak.totalBytes / capacityBytes) * 100) : null;

    return (
        <div className='l1-peak-composition'>
            {exceedsCapacity && (
                <Callout
                    intent={Intent.DANGER}
                    title='These figures are not usable'
                >
                    The replay reports {formatMemorySize(peak.totalBytes, 2)} against a per-core L1 of{' '}
                    {formatMemorySize(capacityBytes ?? 0, 2)}, which is not reachable state. This capture does not carry
                    enough information to reconstruct it — typically an entire run filed under one operation, or
                    deallocate records with no address, leaving nothing to free and no boundary to correct at.
                </Callout>
            )}

            <div className='l1-peak-headline'>
                <div className='l1-peak-figure'>
                    <span className='l1-peak-value'>{formatMemorySize(peak.totalBytes, 2)}</span>
                    <span className='l1-peak-caption'>
                        peak L1 per core, at operation {peak.operationId}
                        {percentOfCapacity !== null &&
                            ` — ${percentOfCapacity}% of ${formatMemorySize(capacityBytes ?? 0, 2)}`}
                    </span>
                </div>

                <Tag
                    minimal
                    intent={peak.precision === L1PeakPrecision.Exact ? Intent.SUCCESS : Intent.WARNING}
                >
                    {peak.precision === L1PeakPrecision.Exact ? 'Exact' : 'Upper bound'}
                </Tag>
            </div>

            {peak.precision === L1PeakPrecision.UpperBound && (
                <p className='l1-peak-note'>
                    Summing residents assumes they share cores. A buffer allocation records how many cores it spans but
                    not which, so a total covering more than one resident is a ceiling, not a measurement.
                </p>
            )}

            <Plot
                className='l1-peak-plot'
                data={chartData}
                layout={{
                    autosize: true,
                    height: 360,
                    margin: { l: 70, r: 20, t: 10, b: 45 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    font: { color: chrome.text },
                    xaxis: {
                        title: { text: 'Operation' },
                        gridcolor: chrome.line,
                        linecolor: chrome.line,
                        color: chrome.text,
                        zeroline: false,
                        // Unified hover draws a spike line; the default is a thick opaque bar
                        // that hides the very columns it is pointing at.
                        showspikes: true,
                        spikecolor: chrome.line,
                        spikethickness: 1,
                        spikedash: 'dot',
                        spikemode: 'across',
                    },
                    yaxis: {
                        title: { text: 'Bytes per core' },
                        gridcolor: chrome.line,
                        linecolor: chrome.line,
                        color: chrome.text,
                        rangemode: 'tozero',
                        zeroline: false,
                    },
                    // Plotly's default hover label is a light surface, which on this page
                    // renders pale grey text on white.
                    hoverlabel: {
                        bgcolor: chrome.surface,
                        bordercolor: chrome.line,
                        font: { color: chrome.text },
                    },
                    legend: { orientation: 'h', y: -0.2 },
                    // A stacked composition is only readable if hovering reports every class at
                    // that operation. Per-trace hover picks whichever band is nearest, which on a
                    // class that happens to be empty there reads as an unexplained "0 B".
                    hovermode: 'x unified',
                    shapes: capacityBytes
                        ? [
                              {
                                  type: 'line',
                                  xref: 'paper',
                                  x0: 0,
                                  x1: 1,
                                  y0: capacityBytes,
                                  y1: capacityBytes,
                                  line: { color: L1_PEAK_COLORS.capacity, width: 1, dash: 'dash' },
                              },
                          ]
                        : [],
                }}
                config={{ displayModeBar: false, responsive: true }}
                useResizeHandler
            />

            <h3>Tightest operations</h3>

            <table className='l1-peak-table'>
                <thead>
                    <tr>
                        <th>Operation</th>
                        <th>Total</th>
                        {SERIES.map(({ key, label }) => (
                            <th key={key}>{label}</th>
                        ))}
                        <th>Largest resident</th>
                    </tr>
                </thead>
                <tbody>
                    {topOperations.map((entry) => {
                        const largest = entry.contributors[0];

                        return (
                            <tr key={entry.operationId}>
                                <td>{entry.operationId}</td>
                                <td className='l1-peak-total'>{formatMemorySize(entry.totalBytes, 2)}</td>
                                {SERIES.map(({ key }) => (
                                    <td key={key}>{entry[key] === 0 ? '—' : formatMemorySize(entry[key], 2)}</td>
                                ))}
                                <td>
                                    {largest
                                        ? `${KIND_LABEL[largest.kind]} @${prettyPrintAddress(
                                              largest.address,
                                              capacityBytes ?? L1_DEFAULT_MEMORY_SIZE,
                                              showHex,
                                          )} (${formatMemorySize(largest.bytes, 2)})`
                                        : '—'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {result.reconciledAwayCount > 0 && (
                <p className='l1-peak-note'>
                    {result.reconciledAwayCount} allocations were dropped when reconciling the replay against the
                    per-operation snapshot — the captured graph reports fewer frees than allocations, so the snapshot
                    decides what survives each operation.
                </p>
            )}
        </div>
    );
}

export default L1PeakComposition;
