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

interface NPEHeatMapProps {
    timestepList: TimestepData[];
    canvasWidth: number;
    useTimesteps: boolean;
    cyclesPerTimestep: number;
    selectedZoneList: NPERootZoneUXInfo[];
    nocType?: NoCType | null;
}
const CANVAS_HEIGHT = 30;
const ZONE_RANGE_HEIGHT = 10;
const ZONE_HEIGHT = 10;

const NPECongestionHeatMap: React.FC<NPEHeatMapProps> = ({
    timestepList,
    canvasWidth,
    nocType = null,
    useTimesteps,
    cyclesPerTimestep,
    selectedZoneList = [],
}) => {
    const altCongestionColors = useAtomValue(altCongestionColorsAtom);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // this will be needed for rendering all zones, not just root zones
    // const HEIGHT_PER_ZONE = 20;
    // const getMaxDepth = (z: NPEZone): number => (z.zones?.length ? 1 + Math.max(...z.zones.map(getMaxDepth)) : 0);
    // const zoneDepth = Math.max(
    //     ...selectedZoneList.flatMap((zone) => {
    //         return zone.zones.map((z) => 1 + getMaxDepth(z));
    //     }),
    //     0,
    // );
    const getZoneDrawing = useCallback(
        (zones: NPEZone[], depth: number): ZoneDrawingInfo[] => {
            return zones.flatMap((zone) => {
                return [
                    {
                        depth,
                        start: zone.start / cyclesPerTimestep,
                        end: zone.end / cyclesPerTimestep,
                    } as ZoneDrawingInfo,
                    ...getZoneDrawing(zone.zones, depth + 1),
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
                groupIndex += 1;
                const childZones = rootZone.expandedState ? getZoneDrawing(rootZone.zones, 1) : [];
                const maxDepth = childZones.length ? Math.max(...childZones.map((z) => z.depth)) : 0;
                maxZoneDepth += 1 + maxDepth;
                return rootZone.zones.map((zone) => ({
                    groupIndex,
                    maxDepth, // rows for children in this group
                    proc: rootZone.proc,
                    start: zone.start / cyclesPerTimestep,
                    end: zone.end / cyclesPerTimestep,
                    zones: childZones, // children shared per root
                }));
            }),
            maxZoneDepth,
        };
    }, [selectedZoneList, cyclesPerTimestep, getZoneDrawing]);

    // const expandedZoneRanges = useMemo(() => {
    //     return (
    //         selectedZoneList
    //             .filter((rootZone) => rootZone.expandedState)
    //             // .filter((rootZone) => true)
    //             .map((rootZone) => {
    //                 return getZoneDrawing(rootZone.zones, 1);
    //             })
    //     );
    // }, [getZoneDrawing, selectedZoneList]);
    // const maxZoneDepth =
    //     Math.max(...expandedZoneRanges.flatMap((range) => range.map((r) => r.depth)), 0) + zoneRanges.length;
    // console.log(expandedZoneRanges);
    // console.log('maxZoneDepth', maxZoneDepth);

    const canvasZoneHeight = zoneRanges.maxZoneDepth * ZONE_RANGE_HEIGHT;
    const [tooltip, setTooltip] = useState<{ x: number; y: number; text: React.JSX.Element } | null>(null);
    const congestionMapPerTimestamp = useMemo(() => {
        return {
            worst: timestepList.map((timestep) => {
                if (nocType) {
                    const value = Math.max(
                        -1,
                        ...timestep.link_demand
                            .filter((linkData) => linkData[NPE_LINK.NOC_ID].indexOf(nocType) === 0)
                            .map((linkData) => linkData[NPE_LINK.DEMAND]),
                    );
                    const color = calculateLinkCongestionColor(value, 0, altCongestionColors);
                    return { value, color };
                }
                const value = Math.max(-1, ...timestep.link_demand.map((linkData) => linkData[NPE_LINK.DEMAND]));
                const color = calculateLinkCongestionColor(value, 0, altCongestionColors);
                return { value, color };
            }),

            utilization: timestepList.map((timestep) => {
                if (nocType) {
                    const nocData = timestep.noc[nocType];
                    if (nocData) {
                        return {
                            value: nocData.avg_link_util,
                            color: calculateLinkCongestionColor(nocData.avg_link_util, 0, altCongestionColors),
                        };
                    }
                }
                return {
                    value: timestep.avg_link_util,
                    color: calculateLinkCongestionColor(timestep.avg_link_util, 0, altCongestionColors),
                };
            }),

            demand: timestepList.map((timestep) => {
                if (nocType) {
                    const nocData = timestep.noc[nocType];
                    if (nocData) {
                        return {
                            value: nocData.avg_link_demand,
                            color: calculateLinkCongestionColor(nocData.avg_link_demand, 0, altCongestionColors),
                        };
                    }
                }
                const color = calculateLinkCongestionColor(timestep.avg_link_demand, 0, altCongestionColors);
                return {
                    value: timestep.avg_link_demand,
                    color,
                };
            }),
        };
    }, [nocType, timestepList, altCongestionColors]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) {
            return;
        }

        ctx.clearRect(0, 0, canvas.width, CANVAS_HEIGHT + canvasZoneHeight);
        const chunkWidth = canvas.width / congestionMapPerTimestamp.worst.length;
        congestionMapPerTimestamp.worst.forEach(({ color }, index) => {
            ctx.fillStyle = color;
            ctx.fillRect(index * chunkWidth, 0, chunkWidth, CANVAS_HEIGHT / 3);
        });
        congestionMapPerTimestamp.utilization.forEach(({ color }, index) => {
            ctx.fillStyle = color;
            ctx.fillRect(index * chunkWidth, CANVAS_HEIGHT / 3, chunkWidth, (CANVAS_HEIGHT / 3) * 2);
        });
        congestionMapPerTimestamp.demand.forEach(({ color }, index) => {
            ctx.fillStyle = color;
            ctx.fillRect(index * chunkWidth, (CANVAS_HEIGHT / 3) * 2, chunkWidth, CANVAS_HEIGHT / 3);
        });

        const groupBaseY = new Map<number, number>();
        {
            let yCursor = CANVAS_HEIGHT;
            const seen = new Set<number>();

            for (const r of zoneRanges.range) {
                const alreadySeen = seen.has(r.groupIndex);
                if (!alreadySeen) {
                    seen.add(r.groupIndex);
                    groupBaseY.set(r.groupIndex, yCursor);

                    const rows = 1 + (r.maxDepth ?? 0);
                    yCursor += rows * ZONE_RANGE_HEIGHT;
                }
            }
        }

        zoneRanges.range.forEach((range) => {
            const color = getKernelColor(range.proc);
            const startX = range.start * chunkWidth;
            const endX = range.end * chunkWidth;

            const baseY = groupBaseY.get(range.groupIndex)!;

            ctx.fillStyle = color;
            ctx.fillRect(startX, baseY, endX - startX, ZONE_RANGE_HEIGHT);

            if (range.zones.length > 0) {
                const zoneColor = '#fff000';
                range.zones.forEach((childZone) => {
                    const childStartX = childZone.start * chunkWidth;
                    const childEndX = childZone.end * chunkWidth;
                    const childY = baseY + childZone.depth * ZONE_RANGE_HEIGHT;

                    ctx.fillStyle = zoneColor;
                    ctx.fillRect(childStartX, childY, childEndX - childStartX, ZONE_HEIGHT);
                });
            }
        });
        // zoneRanges.forEach((range, index) => {
        //     const color = getKernelColor(range.proc);
        //     const startX = range.start * chunkWidth;
        //     const endX = range.end * chunkWidth;
        //     ctx.fillStyle = color;
        //     ctx.fillRect(startX, CANVAS_HEIGHT + index * ZONE_RANGE_HEIGHT, endX - startX, ZONE_RANGE_HEIGHT);
        //     // draw child zones if expanded
        //     if (range.zones.length > 0) {
        //         range.zones.forEach((childZone) => {
        //             const childStartX = childZone.start * chunkWidth;
        //             const childEndX = childZone.end * chunkWidth;
        //             const childY =
        //                 CANVAS_HEIGHT + (index + childZone.depth) * ZONE_RANGE_HEIGHT; /* offset by parent zone index */
        //             ctx.fillStyle = getKernelColor(range.proc);
        //             ctx.fillRect(childStartX, childY, childEndX - childStartX, ZONE_HEIGHT);
        //         });
        //     }
        // });
    }, [
        //
        congestionMapPerTimestamp,
        canvasWidth,
        canvasZoneHeight,
        selectedZoneList,
        zoneRanges,
    ]);

    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const chunkWidth = rect.width / congestionMapPerTimestamp.worst.length;
            const hoveredIndex = Math.floor(mouseX / chunkWidth);
            const y = event.clientY - rect.top;

            const zoneindex = y > CANVAS_HEIGHT ? Math.floor((y - CANVAS_HEIGHT) / ZONE_RANGE_HEIGHT) : null;

            const zoneConversionRatio = useTimesteps ? 1 : cyclesPerTimestep;
            const units = useTimesteps ? 'Timestep' : 'Cycle';
            if (hoveredIndex > -1) {
                const x = mouseX;

                const congestionHoverCondition = zoneindex === null;
                const zoneHoverCondition =
                    zoneindex !== null && zoneRanges[zoneindex] && hoveredIndex < zoneRanges[zoneindex].end;
                if (!congestionHoverCondition && !zoneHoverCondition) {
                    setTooltip(null);
                    return;
                }

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
                                            style={{
                                                backgroundColor: congestionMapPerTimestamp.worst[hoveredIndex].color,
                                            }}
                                        />{' '}
                                        Max Demand:{' '}
                                        {congestionMapPerTimestamp.worst[hoveredIndex].value > -1
                                            ? `${congestionMapPerTimestamp.worst[hoveredIndex].value.toFixed(3)} %`
                                            : 'N/A'}
                                    </div>
                                    <div>
                                        <span
                                            className='color-square'
                                            style={{
                                                backgroundColor:
                                                    congestionMapPerTimestamp.utilization[hoveredIndex].color,
                                            }}
                                        />
                                        {` Avg Utilization: ${congestionMapPerTimestamp.utilization[hoveredIndex].value.toFixed(3)} %`}
                                    </div>
                                    <div>
                                        <span
                                            className='color-square'
                                            style={{
                                                backgroundColor: congestionMapPerTimestamp.demand[hoveredIndex].color,
                                            }}
                                        />
                                        {` Avg Demand: ${congestionMapPerTimestamp.demand[hoveredIndex].value.toFixed(3)} %`}
                                    </div>
                                </>
                            )}
                            {zoneHoverCondition && (
                                <div>
                                    {zoneRanges[zoneindex!].proc}: {units.toLowerCase()}{' '}
                                    {(zoneRanges[zoneindex!].start * zoneConversionRatio).toFixed(0)} -{' '}
                                    {(zoneRanges[zoneindex!].end * zoneConversionRatio).toFixed(0)}
                                </div>
                            )}
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
        <>
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
                                offset: [tooltip.x, CANVAS_HEIGHT + canvasZoneHeight + 30],
                            },
                        },
                    }}
                >
                    <div
                        style={{
                            //
                            position: 'absolute',
                            top: 0,
                            left: `${tooltip.x}px`,
                            width: '0',
                            height: '0',
                            backgroundColor: '#fff',
                            zIndex: 100,
                        }}
                    />
                </Tooltip>
            )}
            <canvas
                style={{ width: '100%', height: `${CANVAS_HEIGHT + canvasZoneHeight}px` }}
                ref={canvasRef}
                width={canvasWidth}
                height={CANVAS_HEIGHT + canvasZoneHeight}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
            />
        </>
    );
};

export default NPECongestionHeatMap;
