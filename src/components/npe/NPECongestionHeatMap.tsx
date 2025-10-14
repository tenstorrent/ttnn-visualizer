// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import { useAtomValue } from 'jotai';
import { calculateLinkCongestionColor } from './drawingApi';
import { NPE_LINK, NoCType, TimestepData } from '../../model/NPEModel';
import { highContrastCongestionAtom } from '../../store/app';

interface NPEHeatMapProps {
    timestepList: TimestepData[];
    canvasWidth: number;
    nocType?: NoCType | null;
}

const NPECongestionHeatMap: React.FC<NPEHeatMapProps> = ({ timestepList, canvasWidth, nocType = null }) => {
    const isHighContrast = useAtomValue(highContrastCongestionAtom);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const canvasHeight = 30;

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
                    const color = calculateLinkCongestionColor(value, 0, isHighContrast);
                    return { value, color };
                }
                const value = Math.max(-1, ...timestep.link_demand.map((linkData) => linkData[NPE_LINK.DEMAND]));
                const color = calculateLinkCongestionColor(value, 0, isHighContrast);
                return { value, color };
            }),

            utilization: timestepList.map((timestep) => {
                if (nocType) {
                    const nocData = timestep.noc[nocType];
                    if (nocData) {
                        return {
                            value: nocData.avg_link_util,
                            color: calculateLinkCongestionColor(nocData.avg_link_util, 0, isHighContrast),
                        };
                    }
                }
                return {
                    value: timestep.avg_link_util,
                    color: calculateLinkCongestionColor(timestep.avg_link_util, 0, isHighContrast),
                };
            }),

            demand: timestepList.map((timestep) => {
                if (nocType) {
                    const nocData = timestep.noc[nocType];
                    if (nocData) {
                        return {
                            value: nocData.avg_link_demand,
                            color: calculateLinkCongestionColor(nocData.avg_link_demand, 0, isHighContrast),
                        };
                    }
                }
                const color = calculateLinkCongestionColor(timestep.avg_link_demand, 0, isHighContrast);
                return {
                    value: timestep.avg_link_demand,
                    color,
                };
            }),
        };
    }, [nocType, timestepList, isHighContrast]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');

        if (!canvas || !ctx) {
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const chunkWidth = canvas.width / congestionMapPerTimestamp.worst.length;
        congestionMapPerTimestamp.worst.forEach(({ color }, index) => {
            ctx.fillStyle = color;
            ctx.fillRect(index * chunkWidth, 0, chunkWidth, canvas.height / 3);
        });
        congestionMapPerTimestamp.utilization.forEach(({ color }, index) => {
            ctx.fillStyle = color;
            ctx.fillRect(index * chunkWidth, canvas.height / 3, chunkWidth, (canvas.height / 3) * 2);
        });
        congestionMapPerTimestamp.demand.forEach(({ color }, index) => {
            ctx.fillStyle = color;
            ctx.fillRect(index * chunkWidth, (canvas.height / 3) * 2, chunkWidth, canvas.height);
        });
    }, [congestionMapPerTimestamp, canvasWidth, canvasHeight]);

    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const chunkWidth = rect.width / congestionMapPerTimestamp.worst.length;
            const hoveredIndex = Math.floor(mouseX / chunkWidth);

            if (hoveredIndex > -1) {
                const x = mouseX;

                setTooltip({
                    x,
                    y: 0,
                    text: (
                        <div>
                            {nocType !== undefined && <div>Selected {nocType}</div>}
                            <div>
                                <span
                                    style={{
                                        width: '10px',
                                        height: '10px',
                                        display: 'inline-block',
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
                                    style={{
                                        width: '10px',
                                        height: '10px',
                                        display: 'inline-block',
                                        backgroundColor: congestionMapPerTimestamp.utilization[hoveredIndex].color,
                                    }}
                                />
                                {` Avg Utilization: ${congestionMapPerTimestamp.utilization[hoveredIndex].value.toFixed(3)} %`}
                            </div>
                            <div>
                                <span
                                    style={{
                                        width: '10px',
                                        height: '10px',
                                        display: 'inline-block',
                                        backgroundColor: congestionMapPerTimestamp.demand[hoveredIndex].color,
                                    }}
                                />
                                {` Avg Demand: ${congestionMapPerTimestamp.demand[hoveredIndex].value.toFixed(3)} %`}
                            </div>
                        </div>
                    ),
                });
            } else {
                // eslint-disable-next-line no-unused-expressions, @typescript-eslint/no-unused-expressions
                canvasRef.current && (canvasRef.current.style.cursor = 'default');
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
                                offset: [tooltip.x, canvasHeight * 1.5],
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
                            backgroundColor: 'red',
                            zIndex: 100,
                        }}
                    />
                </Tooltip>
            )}
            <canvas
                title='NOC timeline'
                style={{ width: '100%', height: `${canvasHeight}px` }}
                ref={canvasRef}
                width={canvasWidth}
                height={canvasHeight}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
            />
        </>
    );
};

export default NPECongestionHeatMap;
