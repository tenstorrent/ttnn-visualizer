// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import { useAtomValue } from 'jotai';
import { calculateLinkCongestionColor } from './drawingApi';
import {
    NPERootZoneUXInfo,
    NPEZone,
    NPE_LINK,
    NoCType,
    TimestepData,
    ZoneDrawingInfo,
    getKernelColor,
} from '../../model/NPEModel';
import { altCongestionColorsAtom } from '../../store/app';
import getWorstLinkDemand from '../../functions/getWorstLinkDemand';
import { formatPercentage } from '../../functions/math';

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface NPEHeatMapProps {
    timestepList: TimestepData[];
    canvasWidth: number;
    useTimesteps: boolean;
    currentTimestep?: number;
    cyclesPerTimestep: number;
    selectedZoneList: NPERootZoneUXInfo[];
    nocType?: NoCType | null;
    navigationCallback: (timestepIndex: number) => void;
}
const HEATMAP_HEIGHT = 30;
const ZONE_HEIGHT = 10;

const NPETimelineComponent = ({
    timestepList,
    canvasWidth,
    nocType = null,
    useTimesteps,
    currentTimestep,
    cyclesPerTimestep,
    selectedZoneList = [],
    navigationCallback,
}: NPEHeatMapProps) => {
    const altCongestionColors = useAtomValue(altCongestionColorsAtom);
    // The heatmap canvas repaints only when its pixels change (data / width /
    // zones). The playhead — the only thing a scrub moves — is a positioned div
    // above it, so a tick costs one style update rather than any canvas work. #1803.
    const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const stackRef = useRef<HTMLDivElement | null>(null);
    const [hoverMap, setHoverMap] = useState<Map<string, Rect>>(new Map());

    const getZoneDrawingModel = useCallback(
        (zones: NPEZone[], depth: number): ZoneDrawingInfo[] => {
            return zones.flatMap((zone) => {
                return [
                    {
                        id: zone.id,
                        depth,
                        start: zone.start / cyclesPerTimestep,
                        end: zone.end / cyclesPerTimestep,
                    } as ZoneDrawingInfo,
                    // TODO: @aidemsined to look at this
                    // eslint-disable-next-line react-hooks/immutability
                    ...getZoneDrawingModel(zone.zones, depth + 1),
                ];
            });
        },
        [cyclesPerTimestep],
    );

    const zoneRanges = useMemo(() => {
        let maxZoneDepth = 0;
        let groupIndex = -1;
        return {
            range: selectedZoneList.flatMap((rootZone) => {
                // eslint-disable-next-line react-hooks/immutability
                groupIndex += 1;
                const childZones = rootZone.expandedState ? getZoneDrawingModel(rootZone.zones, 1) : [];
                const maxDepth = childZones.length ? Math.max(...childZones.map((z) => z.depth)) : 0;
                maxZoneDepth += 1 + maxDepth;
                return rootZone.zones.map((zone) => ({
                    groupIndex,
                    maxDepth,
                    proc: rootZone.proc,
                    start: zone.start / cyclesPerTimestep,
                    end: zone.end / cyclesPerTimestep,
                    zones: childZones,
                }));
            }),
            maxZoneDepth,
        };
    }, [selectedZoneList, cyclesPerTimestep, getZoneDrawingModel]);

    const canvasZoneHeight = zoneRanges.maxZoneDepth * ZONE_HEIGHT;
    const [tooltip, setTooltip] = useState<{ x: number; y: number; text: React.JSX.Element } | null>(null);

    // Per-timestep metric values only — no colours. The tooltip needs a value for
    // whichever step is hovered, but colourising all of them cost one
    // `calculateLinkCongestionColor` call per step per row (4 × n_timesteps, ~780k
    // on a 196k-step report) to produce pixels that were then thrown away by
    // sub-pixel overdraw. Colours are now computed per drawn column instead. #1803.
    const metricValues = useMemo(() => {
        const worst: number[] = [];
        const utilization: number[] = [];
        const demand: number[] = [];
        const mcast: (number | undefined)[] = [];

        for (const timestep of timestepList) {
            const links = nocType
                ? timestep.link_demand.filter((linkData) => linkData[NPE_LINK.NOC_ID].startsWith(nocType))
                : timestep.link_demand;

            // Windowed loading (#861) supplies `link_demand` only for the visited
            // step; other steps fall back to the per-step scalar from the summary.
            // Known limitation: that scalar is the global (both-NOC) worst, and
            // non-visited `noc` aggregates are stubbed to 0, so with a NOC filter
            // active the heat rows for non-visited steps are approximate until the
            // summary carries per-NOC aggregates. Unfiltered view is exact.
            worst.push(getWorstLinkDemand(links, timestep.max_link_demand));

            const nocData = nocType ? timestep.noc?.[nocType] : undefined;
            utilization.push(nocData?.avg_link_util ?? timestep.avg_link_util);
            demand.push(nocData?.avg_link_demand ?? timestep.avg_link_demand);
            mcast.push(timestep.mcast_write_link_util);
        }

        return { worst, utilization, demand, mcast };
    }, [nocType, timestepList]);

    const dataSize = metricValues.worst.length;

    // One column per device pixel at most. Beyond that the old code emitted a
    // fillRect per timestep — ~0.008px wide at 196k steps — so each screen pixel
    // was written hundreds of times and only the last (blended) write survived.
    // That was both wasteful and lossy: an isolated congestion spike could be
    // averaged into invisibility. Reducing each column to the MAX of the steps it
    // covers keeps spikes visible, which is the point of a congestion heat bar.
    const columnCount = Math.max(1, Math.min(Math.round(canvasWidth), dataSize));

    const heatColumns = useMemo(() => {
        const color = (v: number) => calculateLinkCongestionColor(v, 0, altCongestionColors);
        // `undefined` (mcast N/A) has no colour of its own — it shares the -1
        // "no data" ramp entry, matching the previous `color(mcast ?? -1)`.
        const maxOf = (values: (number | undefined)[], start: number, end: number): number | undefined => {
            let max: number | undefined;
            for (let i = start; i < end; i++) {
                const value = values[i];
                if (value !== undefined && (max === undefined || value > max)) {
                    max = value;
                }
            }
            return max;
        };

        const reduce = (values: (number | undefined)[]): string[] => {
            const columns: string[] = [];
            for (let col = 0; col < columnCount; col++) {
                const start = Math.floor((col * dataSize) / columnCount);
                // Always cover at least one step so a column can't come out empty
                // when columnCount and dataSize are close.
                const end = Math.max(start + 1, Math.floor(((col + 1) * dataSize) / columnCount));
                columns.push(color(maxOf(values, start, Math.min(end, dataSize)) ?? -1));
            }
            return columns;
        };

        return [
            reduce(metricValues.worst),
            reduce(metricValues.utilization),
            reduce(metricValues.demand),
            reduce(metricValues.mcast),
        ];
    }, [metricValues, columnCount, dataSize, altCongestionColors]);

    useEffect(() => {
        const canvas = heatmapCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) {
            return;
        }

        ctx.clearRect(0, 0, canvas.width, HEATMAP_HEIGHT + canvasZoneHeight);

        const numLines = heatColumns.length;
        const rowHeight = HEATMAP_HEIGHT / numLines;
        const columnWidth = canvas.width / columnCount;

        // A report with no timesteps has no heat rows to draw — zones below still do.
        for (let row = 0; dataSize > 0 && row < numLines; row++) {
            const y = row * rowHeight;
            const columns = heatColumns[row];
            let runStart = 0;

            // Coalesce neighbouring columns that resolved to the same colour into
            // one rect. Long idle stretches collapse to a handful of fills, and it
            // avoids per-column `fillStyle` churn.
            for (let col = 0; col < columnCount; col++) {
                const isLast = col === columnCount - 1;
                if (isLast || columns[col + 1] !== columns[runStart]) {
                    ctx.fillStyle = columns[runStart];
                    const x = runStart * columnWidth;
                    // Ceil the span so sub-pixel column widths can't leave seams.
                    ctx.fillRect(x, y, Math.ceil((col + 1) * columnWidth - x), rowHeight);
                    runStart = col + 1;
                }
            }
        }

        const chunkWidth = canvas.width / dataSize;

        const groupBaseY = new Map<number, number>();
        {
            let yCursor = HEATMAP_HEIGHT;
            const seen = new Set<number>();

            for (const rootZone of zoneRanges.range) {
                const alreadySeen = seen.has(rootZone.groupIndex);
                if (!alreadySeen) {
                    seen.add(rootZone.groupIndex);
                    groupBaseY.set(rootZone.groupIndex, yCursor);

                    const rows = 1 + (rootZone.maxDepth ?? 0);
                    yCursor += rows * ZONE_HEIGHT;
                }
            }
        }

        const hovermap = new Map<string, Rect>();

        zoneRanges.range.forEach((range) => {
            const color = getKernelColor(range.proc);
            const baseY = groupBaseY.get(range.groupIndex)!;
            {
                const x = range.start * chunkWidth;
                const end = range.end * chunkWidth;
                const rect: Rect = { x, y: baseY, width: end - x, height: ZONE_HEIGHT - 1 };
                ctx.fillStyle = color;
                ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
                hovermap.set(range.proc, rect);
            }
            if (range.zones.length > 0) {
                const zoneColor = '#fff000';
                range.zones.forEach((zone) => {
                    const x = zone.start * chunkWidth;
                    const end = zone.end * chunkWidth;
                    const y = baseY + zone.depth * ZONE_HEIGHT;
                    const rect: Rect = { x, y, width: end - x, height: ZONE_HEIGHT - 1 };
                    ctx.fillStyle = zoneColor;
                    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
                    hovermap.set(zone.id, rect);
                });
            }
        });

        setHoverMap(hovermap);
    }, [
        //
        heatColumns,
        columnCount,
        dataSize,
        canvasWidth,
        canvasZoneHeight,
        selectedZoneList,
        zoneRanges,
    ]);

    // The playhead is a positioned div rather than a canvas layer: a scrub then
    // changes one style value the compositor can act on, instead of clearing and
    // repainting a full-width canvas every tick. Percent-based so it needs no
    // measurement and stays correct as the timeline is resized.
    const playheadPercent = dataSize ? ((currentTimestep ?? 0) / dataSize) * 100 : 0;

    const handleTimelineClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const stack = stackRef.current;
        if (stack && dataSize) {
            const rect = stack.getBoundingClientRect();
            const chunkWidth = rect.width / dataSize;
            const index = Math.floor((event.clientX - rect.left) / chunkWidth);
            navigationCallback(index);
        }
    };
    const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        const stack = stackRef.current;
        if (stack && dataSize) {
            const rect = stack.getBoundingClientRect();
            // `hoverMap` rects are in canvas-pixel space, so scale the pointer into
            // it for zone hit-testing while the index stays in CSS space.
            const scaleX = canvasWidth / rect.width;
            const mouseX = (event.clientX - rect.left) * scaleX;
            const chunkWidth = rect.width / dataSize;
            const hoveredIndex = Math.floor((event.clientX - rect.left) / chunkWidth);
            const y = event.clientY - rect.top;
            const x = mouseX;

            const zoneArea = y > HEATMAP_HEIGHT;

            const zoneConversionRatio = useTimesteps ? 1 : cyclesPerTimestep;
            const units = useTimesteps ? 'Timestep' : 'Cycle';

            if (hoveredIndex > -1) {
                const congestionHoverCondition = !zoneArea;
                const hoveredZone = Array.from(hoverMap.entries()).find(([_, r]) => {
                    return y >= r.y && y <= r.y + r.height && x >= r.x && x <= r.x + r.width;
                });
                if (!congestionHoverCondition && hoveredZone === undefined) {
                    setTooltip(null);
                    return;
                }

                // Colours for the hovered step only — four calls, versus
                // colourising every step up front.
                const swatch = (value: number | undefined) =>
                    calculateLinkCongestionColor(value ?? -1, 0, altCongestionColors);
                const worstValue = metricValues.worst[hoveredIndex];
                const utilizationValue = metricValues.utilization[hoveredIndex];
                const demandValue = metricValues.demand[hoveredIndex];
                const mcastValue = metricValues.mcast[hoveredIndex];

                setTooltip({
                    x,
                    y: 0,
                    text: (
                        <div className='congestion-heatmap-tooltip'>
                            <h3>
                                {units} {hoveredIndex * zoneConversionRatio}
                            </h3>
                            {nocType !== null && <div>Selected {nocType}</div>}
                            {congestionHoverCondition && (
                                <>
                                    <div>
                                        <span
                                            className='color-square'
                                            style={{ backgroundColor: swatch(worstValue) }}
                                        />{' '}
                                        Max Demand: {worstValue > -1 ? `${formatPercentage(worstValue, 3)}` : 'N/A'}
                                    </div>
                                    <div>
                                        <span
                                            className='color-square'
                                            style={{ backgroundColor: swatch(utilizationValue) }}
                                        />
                                        {` Avg Utilization: ${formatPercentage(utilizationValue, 3)}`}
                                    </div>
                                    <div>
                                        <span
                                            className='color-square'
                                            style={{ backgroundColor: swatch(demandValue) }}
                                        />
                                        {` Avg Demand: ${formatPercentage(demandValue, 3)}`}
                                    </div>

                                    <div>
                                        <span
                                            className='color-square'
                                            style={{ backgroundColor: swatch(mcastValue) }}
                                        />
                                        {` Multicast Utilization:`}{' '}
                                        {mcastValue !== undefined ? `${formatPercentage(mcastValue, 3)}` : 'N/A'}
                                    </div>
                                </>
                            )}
                            {hoveredZone &&
                                (() => {
                                    const [id] = hoveredZone;
                                    return <div>{id}</div>;
                                })()}
                        </div>
                    ),
                });
            } else {
                setTooltip(null);
            }
        }
    };

    const handleMouseLeave = () => {
        setTooltip(null);
    };

    return (
        // The tooltip's Blueprint target lives inside this relative, fixed-height
        // wrapper on purpose: as an inline element it would otherwise force its own
        // line box above the block canvas stack and shove the timeline down when it
        // mounts on hover. Contained here (canvases are absolute), it can't reflow
        // anything, and the absolute anchor is positioned relative to the timeline.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
        <div
            className='npe-timeline-canvas-stack'
            ref={stackRef}
            style={{ position: 'relative', width: '100%', height: `${HEATMAP_HEIGHT + canvasZoneHeight}px` }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleTimelineClick}
        >
            <canvas
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                ref={heatmapCanvasRef}
                width={canvasWidth}
                height={HEATMAP_HEIGHT + canvasZoneHeight}
            />
            <div
                className='npe-timeline-playhead'
                style={{ left: `${playheadPercent}%` }}
            />
            {tooltip && (
                <Tooltip
                    content={tooltip.text}
                    position={PopoverPosition.TOP}
                    hoverOpenDelay={0}
                    hoverCloseDelay={0}
                    isOpen
                    usePortal
                    minimal
                    modifiers={{
                        offset: {
                            enabled: true,
                            options: {
                                offset: [tooltip.x, HEATMAP_HEIGHT + canvasZoneHeight + 30],
                            },
                        },
                    }}
                >
                    <div
                        className='timeline-tooltip-anchor'
                        style={{
                            left: `${tooltip.x}px`,
                        }}
                    />
                </Tooltip>
            )}
        </div>
    );
};

export default NPETimelineComponent;
