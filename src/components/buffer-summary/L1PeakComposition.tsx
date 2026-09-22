// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Callout, Intent, Tag } from '@blueprintjs/core';
import { useAtomValue } from 'jotai';
import { Link } from 'react-router';
import { PlotData } from 'plotly.js';
import { useMemo } from 'react';
import Plot from '../../libs/PlotComponent';
import {
    L1PeakPrecision,
    L1PeakStatus,
    L1_PEAK_SERIES,
    L1_RESIDENT_KIND_LABEL,
    getL1PeakColours,
} from '../../definitions/L1PeakDecomposition';
import { formatMemorySize, prettyPrintAddress } from '../../functions/math';
import { showHexAtom } from '../../store/app';
import { L1_DEFAULT_MEMORY_SIZE } from '../../definitions/L1MemorySize';
import { getPerfChartChrome } from '../../definitions/PlotConfigurations';
import { useL1PeakDecomposition } from '../../hooks/useL1PeakDecomposition';
import { useDevices, useOperationsList } from '../../hooks/useAPI';
import ROUTES from '../../definitions/Routes';
import 'styles/components/L1PeakComposition.scss';

const TOP_OPERATION_COUNT = 10;

function L1PeakComposition() {
    const { status, data: result, unattributableStaleAddressCount } = useL1PeakDecomposition();
    const { data: operations } = useOperationsList();
    const { data: devices } = useDevices();
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
        const byComposition = new Map<string, { entry: (typeof ordered)[number]; alsoAt: number[] }>();

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
                    seen.alsoAt.push(entry.operationId);
                } else {
                    byComposition.set(key, { entry, alsoAt: [] });
                }
            });

        return [...byComposition.values()].slice(0, TOP_OPERATION_COUNT);
    }, [ordered]);

    // Every plotted and listed value carries its own precision, and a lower operation can be a
    // ceiling while the peak happens to have one resident.
    const anyUpperBound = ordered.some((entry) => entry.precision === L1PeakPrecision.UPPER_BOUND);

    const hasRepeats = topOperations.some(({ alsoAt }) => alsoAt.length > 0);

    const chartData = useMemo<Partial<PlotData>[]>(() => {
        const x = ordered.map((entry) => entry.operationId);

        return L1_PEAK_SERIES.map(({ kind, field, label }) => ({
            x,
            y: ordered.map((entry) => entry[field as keyof typeof entry] as number),
            type: 'scatter',
            mode: 'lines',
            stackgroup: 'l1',
            name: label,
            line: { width: 0, color: colours[kind] },
            fillcolor: colours[kind],
            // Unified hover below, so the trace name is the row label and the box already
            // carries the operation. Repeating either would print it four times.
            // `.0f`: a per-bank figure derived as size/num_cores is not always whole, and a
            // hover reading "207,177.5 B" invites a question the number cannot answer.
            hovertemplate: `%{y:,.0f} B<extra>${label}</extra>`,
        }));
    }, [ordered, colours]);

    const deviceCount = devices?.length ?? 0;
    // Declared above the early returns because the refusal below needs it: summing residents
    // across devices is a third way for the total to clear one device's budget, and a notice
    // only reachable past the refusal would leave the refusal naming the two causes that are
    // left. It carries no reference to "above" for the same reason — in that branch there is
    // no figure above it.
    const multiDeviceNotice = deviceCount > 1 && (
        <Callout
            intent={Intent.WARNING}
            title='Multi-device report'
        >
            This report covers {deviceCount} devices. The replay cannot separate them — captures label circular-buffer
            allocation and release with different device ids, so filtering on one drops a whole class of resident —
            while the budget it is judged against is one device&apos;s. The occupancy is therefore summed across devices
            and the percentage is not meaningful.
        </Callout>
    );

    if (status === L1PeakStatus.UNAVAILABLE) {
        return <p className='l1-peak-empty'>Select a memory report to see its L1 peak composition.</p>;
    }

    if (status === L1PeakStatus.LOADING) {
        return <p className='l1-peak-empty'>Replaying captured graphs…</p>;
    }

    if (status === L1PeakStatus.ERROR || result === null) {
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

    // A refusal that still prints the figures underneath is not a refusal.
    if (result.exceedsCapacity) {
        return (
            <>
                {multiDeviceNotice}
                <Callout
                    intent={Intent.DANGER}
                    title='These figures are not usable'
                >
                    <p>
                        The replay reports {formatMemorySize(result.peak.totalBytes, 2)} against a per-core L1 of{' '}
                        {formatMemorySize(result.capacityBytes ?? 0, 2)}. More than one thing produces that, and none of
                        them leave a per-core figure, so it is withheld rather than shown:
                    </p>
                    <ul>
                        {deviceCount > 1 && (
                            <li>
                                the occupancy is summed across this report&apos;s {deviceCount} devices, as the note
                                above says, while the budget is a single device&apos;s;
                            </li>
                        )}
                        <li>
                            the capture does not carry enough information to reconstruct its state — typically an entire
                            run filed under one operation, or deallocate records with no address;
                        </li>
                        <li>its residents occupy disjoint cores, which this model does not yet represent (#2027).</li>
                    </ul>
                </Callout>
            </>
        );
    }

    const { peak, capacityBytes } = result;
    const percentOfCapacity = capacityBytes ? Math.round((peak.totalBytes / capacityBytes) * 100) : null;

    return (
        <div className='l1-peak-composition'>
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
                    intent={peak.precision === L1PeakPrecision.EXACT ? Intent.SUCCESS : Intent.WARNING}
                >
                    {peak.precision === L1PeakPrecision.EXACT ? 'Exact' : 'Upper bound'}
                </Tag>
            </div>

            {anyUpperBound && (
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
                        {L1_PEAK_SERIES.map(({ field, label }) => (
                            <th key={field}>{label}</th>
                        ))}
                        <th>Largest resident</th>
                    </tr>
                </thead>
                <tbody>
                    {topOperations.map(({ entry, alsoAt }) => {
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
                                    {alsoAt.length > 0 && (
                                        <span
                                            className='l1-peak-repeats'
                                            title={`Identical composition at ${alsoAt.join(', ')}`}
                                        >
                                            +{alsoAt.length} like it
                                        </span>
                                    )}
                                </td>
                                <td className='l1-peak-total'>{formatMemorySize(entry.totalBytes, 2)}</td>
                                {L1_PEAK_SERIES.map(({ field }) => {
                                    const bytes = entry[field as keyof typeof entry] as number;

                                    return <td key={field}>{bytes === 0 ? '—' : formatMemorySize(bytes, 2)}</td>;
                                })}
                                <td>
                                    {largest
                                        ? `${L1_RESIDENT_KIND_LABEL[largest.kind]} @${prettyPrintAddress(
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

            {multiDeviceNotice}

            {hasRepeats && (
                <p className='l1-peak-note'>
                    A model that runs the same layer stack more than once produces operations with identical
                    compositions. Those are listed once, marked with how many others match — hover the marker for their
                    operation ids.
                </p>
            )}

            {unattributableStaleAddressCount > 0 && (
                <p className='l1-peak-note'>
                    Stale is a floor. {unattributableStaleAddressCount} addresses are reused by more than one tensor,
                    and nothing in the report says which of them is resident at a given operation. Rather than guess a
                    last use, those residents are counted as persistent — so some of what is shown as persistent may in
                    fact be freeable.
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
