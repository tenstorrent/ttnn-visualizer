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

type Rect = { x: number; y: number; width: number; height: number };
interface NPEHeatMapProps {
    timestepList: TimestepData[];
    canvasWidth: number;
    useTimesteps: boolean;
    cyclesPerTimestep: number;
    selectedZoneList: NPERootZoneUXInfo[];
    nocType?: NoCType | null;
}
const HEATMAP_HEIGHT = 30;
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

        ctx.clearRect(0, 0, canvas.width, HEATMAP_HEIGHT + canvasZoneHeight);
        const chunkWidth = canvas.width / congestionMapPerTimestamp.worst.length;
        congestionMapPerTimestamp.worst.forEach(({ color }, index) => {
            ctx.fillStyle = color;
            ctx.fillRect(index * chunkWidth, 0, chunkWidth, HEATMAP_HEIGHT / 3);
        });
        congestionMapPerTimestamp.utilization.forEach(({ color }, index) => {
            ctx.fillStyle = color;
            ctx.fillRect(index * chunkWidth, HEATMAP_HEIGHT / 3, chunkWidth, (HEATMAP_HEIGHT / 3) * 2);
        });
        congestionMapPerTimestamp.demand.forEach(({ color }, index) => {
            ctx.fillStyle = color;
            ctx.fillRect(index * chunkWidth, (HEATMAP_HEIGHT / 3) * 2, chunkWidth, HEATMAP_HEIGHT / 3);
        });

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
            const scaleX = canvas.width / rect.width;
            const mouseX = (event.clientX - rect.left) * scaleX;
            const chunkWidth = rect.width / congestionMapPerTimestamp.worst.length;
            const hoveredIndex = Math.floor(mouseX / chunkWidth);
            const y = event.clientY - rect.top;

            const zoneArea = y > HEATMAP_HEIGHT;

            const zoneConversionRatio = useTimesteps ? 1 : cyclesPerTimestep;
            const units = useTimesteps ? 'Timestep' : 'Cycle';

            if (hoveredIndex > -1) {
                const x = mouseX;
                const congestionHoverCondition = !zoneArea;

                const hoveredZone = Array.from(hoverMap.entries()).find(([_, r]) => {
                    return y >= r.y && y <= r.y + r.height && x >= r.x && x <= r.x + r.width;
                });
                if (!congestionHoverCondition && hoveredZone === undefined) {
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
                                offset: [tooltip.x, HEATMAP_HEIGHT + canvasZoneHeight + 30],
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
                style={{ width: '100%', height: `${HEATMAP_HEIGHT + canvasZoneHeight}px` }}
                ref={canvasRef}
                width={canvasWidth}
                height={HEATMAP_HEIGHT + canvasZoneHeight}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
            />
        </>
    );
};

export default NPECongestionHeatMap;
