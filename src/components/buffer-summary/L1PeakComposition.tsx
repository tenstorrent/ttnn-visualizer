// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Callout, Intent, Tag } from '@blueprintjs/core';
import { useAtomValue } from 'jotai';
import { Link } from 'react-router';
import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from '../../libs/PlotComponent';
import { L1PeakPrecision, L1ResidentKind } from '../../functions/l1PeakDecomposition';
import { formatMemorySize, prettyPrintAddress } from '../../functions/math';
import { showHexAtom } from '../../store/app';
import { L1_DEFAULT_MEMORY_SIZE } from '../../definitions/L1MemorySize';
import { getL1PeakColours } from '../../definitions/GraphColors';
import { getPerfChartChrome } from '../../definitions/PlotConfigurations';
import { useL1PeakDecomposition } from '../../hooks/useL1PeakDecomposition';
import { L1PeakStatus } from '../../model/L1PeakDecomposition';
import { useOperationsList } from '../../hooks/useAPI';
import ROUTES from '../../definitions/Routes';
import 'styles/components/L1PeakComposition.scss';

const TOP_OPERATION_COUNT = 10;

const SERIES = [
    { key: 'circularBufferBytes', label: 'Circular buffers', token: 'circularBuffer' },
    { key: 'intermediateTensorBytes', label: 'Intermediate tensors', token: 'intermediateTensor' },
    { key: 'persistentTensorBytes', label: 'Persistent tensors', token: 'persistentTensor' },
    { key: 'staleTensorBytes', label: 'Stale tensors', token: 'staleTensor' },
] as const;

const KIND_LABEL: Record<L1ResidentKind, string> = {
    [L1ResidentKind.CircularBuffer]: 'Circular buffer',
    [L1ResidentKind.IntermediateTensor]: 'Intermediate',
    [L1ResidentKind.PersistentTensor]: 'Persistent',
    [L1ResidentKind.StaleTensor]: 'Stale',
};

function L1PeakComposition() {
    const { status, data: result, unattributableStaleAddressCount } = useL1PeakDecomposition();
    const { data: operations } = useOperationsList();
    // Same address presentation as the memory legends, including the hex preference. #2025
    const showHex = useAtomValue(showHexAtom);
    // Resolved on use, not at import: these read from the stylesheet, which may not have
    // applied when the module first evaluates.
    const { chrome, colours } = useMemo(() => ({ chrome: getPerfChartChrome(), colours: getL1PeakColours() }), []);

    const operationNamesById = useMemo(
        () => new Map<number, string>((operations ?? []).map((operation) => [operation.id, operation.name])),
        [operations],
    );

    const ordered = useMemo(
        () => [...(result?.byOperationId.values() ?? [])].sort((left, right) => left.operationId - right.operationId),
        [result],
    );

    const topOperations = useMemo(() => {
        // resnet50 runs the same layer stack three times, so an undeduped ranking spends all
        // ten rows on one loop body — operations 130 and 229 are byte-identical. Keep the first
        // occurrence of each distinct composition and note how many it stands for.
        const byComposition = new Map<string, { entry: (typeof ordered)[number]; repeats: number }>();

        [...ordered]
            .sort((left, right) => right.totalBytes - left.totalBytes)
            .forEach((entry) => {
                const key = [
                    entry.totalBytes,
                    entry.circularBufferBytes,
                    entry.intermediateTensorBytes,
                    entry.persistentTensorBytes,
                    entry.staleTensorBytes,
                ].join(':');
                const seen = byComposition.get(key);

                if (seen) {
                    seen.repeats += 1;
                } else {
                    byComposition.set(key, { entry, repeats: 1 });
                }
            });

        return [...byComposition.values()].slice(0, TOP_OPERATION_COUNT);
    }, [ordered]);

    const chartData = useMemo<Partial<PlotData>[]>(() => {
        const x = ordered.map((entry) => entry.operationId);

        return SERIES.map(({ key, label, token }) => ({
            x,
            y: ordered.map((entry) => entry[key]),
            type: 'scatter',
            mode: 'lines',
            stackgroup: 'l1',
            name: label,
            line: { width: 0, color: colours[token] },
            fillcolor: colours[token],
            // Unified hover below, so the trace name is the row label and the box already
            // carries the operation. Repeating either would print it four times.
            // `.0f`: a per-bank figure derived as size/num_cores is not always whole, and a
            // hover reading "207,177.5 B" invites a question the number cannot answer.
            hovertemplate: `%{y:,.0f} B<extra>${label}</extra>`,
        }));
    }, [ordered, colours]);

    if (status === L1PeakStatus.Unavailable) {
        return <p className='l1-peak-empty'>Select a memory report to see its L1 peak composition.</p>;
    }

    if (status === L1PeakStatus.Loading) {
        return <p className='l1-peak-empty'>Replaying captured graphs…</p>;
    }

    if (status === L1PeakStatus.Error || result === null) {
        return (
            <Callout
                intent={Intent.WARNING}
                title='Could not build the peak composition'
            >
                One of the queries this view replays failed, so there is nothing to decompose. This is a fetch failure,
                not a statement about the report — the buffer endpoint declines payloads it considers too large to
                render.
            </Callout>
        );
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
                                  line: { color: colours.capacity, width: 1, dash: 'dash' },
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
                    {topOperations.map(({ entry, repeats }) => {
                        const largest = entry.contributors[0];

                        return (
                            <tr key={entry.operationId}>
                                <td className='l1-peak-operation'>
                                    <Link
                                        to={`${ROUTES.OPERATIONS}/${entry.operationId}`}
                                        title={operationNamesById.get(entry.operationId) ?? undefined}
                                    >
                                        <span className='l1-peak-operation-id'>{entry.operationId}</span>
                                        <span className='l1-peak-operation-name'>
                                            {operationNamesById.get(entry.operationId) ?? ''}
                                        </span>
                                    </Link>
                                    {repeats > 1 && (
                                        <span
                                            className='l1-peak-repeats'
                                            title={`${repeats} operations share this composition, so only the first is listed`}
                                        >
                                            ×{repeats}
                                        </span>
                                    )}
                                </td>
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

            {unattributableStaleAddressCount > 0 && (
                <p className='l1-peak-note'>
                    Stale is a floor. {unattributableStaleAddressCount} addresses are reused by more than one tensor,
                    and nothing in the report says which of them is resident at a given operation, so those are left
                    unclassified rather than guessed at.
                </p>
            )}

            {result.reconciledAwayCount > 0 && (
                <p className='l1-peak-note'>
                    {result.reconciledAwayCount} allocations were dropped at an operation boundary because the snapshot
                    no longer held them. The captured graph reports fewer frees than allocations, so the snapshot — not
                    the graph — decides what survives each operation; a tensor seeded from one snapshot and gone by the
                    next is counted here too.
                </p>
            )}
        </div>
    );
}

export default L1PeakComposition;
