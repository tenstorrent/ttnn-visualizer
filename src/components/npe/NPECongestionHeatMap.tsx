import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import { calculateLinkCongestionColor } from './drawingApi';
import { TimestepData } from '../../model/NPEModel';

interface NPEHeatMapProps {
    timestepList: TimestepData[];
    canvasWidth: number;
}

const NPECongestionHeatMap: React.FC<NPEHeatMapProps> = ({ timestepList, canvasWidth }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    const canvasHeight = 30;

    const [tooltip, setTooltip] = useState<{ x: number; y: number; text: React.JSX.Element } | null>(null);

    const congestionMapPerTimestamp = useMemo(() => {
        return {
            worst: timestepList.map((timestep) => {
                const value = Math.max(-1, ...timestep.link_demand.map((route) => route[3]));
                return { value, color: calculateLinkCongestionColor(value) };
            }),

            utilization: timestepList.map((timestep) => ({
                value: timestep.avg_link_util,
                color: calculateLinkCongestionColor(timestep.avg_link_util),
            })),

            demand: timestepList.map((timestep) => ({
                value: timestep.avg_link_demand,
                color: calculateLinkCongestionColor(timestep.avg_link_demand),
            })),
        };
    }, [timestepList]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');

        if (!canvas || !ctx) {
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const chunkWidth = canvas.width / congestionMapPerTimestamp.worst.length + 1;
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
                                    ? congestionMapPerTimestamp.worst[hoveredIndex].value.toFixed(2)
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
                                />{' '}
                                Avg Utilization: {congestionMapPerTimestamp.utilization[hoveredIndex].value.toFixed(2)}
                            </div>
                            <div>
                                <span
                                    style={{
                                        width: '10px',
                                        height: '10px',
                                        display: 'inline-block',
                                        backgroundColor: congestionMapPerTimestamp.demand[hoveredIndex].color,
                                    }}
                                />{' '}
                                Avg Demand: {congestionMapPerTimestamp.demand[hoveredIndex].value.toFixed(2)}
                            </div>
                        </div>
                    ),
                });
            } else {
                // eslint-disable-next-line no-unused-expressions
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
