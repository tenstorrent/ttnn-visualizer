import React, { useEffect, useMemo, useRef, useState } from 'react';
import { calculateLinkCongestionColor } from './drawingApi';
import { TimestepData } from '../../model/NPEModel';

interface NPEHeatMapProps {
    timestepList: TimestepData[];
}

const NPECongestionHeatMap: React.FC<NPEHeatMapProps> = ({ timestepList }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [canvasWidth, setCanvasWidth] = useState(window.innerWidth);
    useEffect(() => {
        const handleResize = () => setCanvasWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    const canvasHeight = 30;

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
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
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

    return (
        <canvas
            style={{ width: '100%', height: `${canvasHeight}px` }}
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
        />
    );
};

export default NPECongestionHeatMap;
