// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { MouseEvent, useEffect, useRef } from 'react';
import {
    EVENT_TYPE_FILTER,
    FABRIC_EVENT_SCOPE_OPTIONS,
    LinkUtilization,
    NPE_LINK,
    NoCType,
} from '../../model/NPEModel';
import { LinkPoints, NODE_SIZE, calculateFabricColor, calculateLinkCongestionColor, getLinkPoints } from './drawingApi';

// The link tiles used to be one SVG (+ button + label) per link_demand row —
// up to ~700 per timestep, all reconciled and repainted on every scrub. This
// draws the whole chip's congestion layer to a single canvas instead, turning
// a scrub from thousands of DOM mutations into a few hundred canvas ops. #1803.

const GAP = 1; // matches `.tensix-grid { gap: 1px }`
const CELL_STRIDE = NODE_SIZE + GAP;
const LABEL_FONT = '9px sans-serif';
const LABEL_COLOR = 'rgba(255, 255, 255, 0.85)';
const DIMMED_ALPHA = 0.15;

interface ChipLink {
    linkUtilization: LinkUtilization;
    index: number;
}

interface ChipCongestionCanvasProps {
    links: ChipLink[];
    gridWidth: number;
    gridHeight: number;
    isFabricMode: boolean;
    altCongestionColors: boolean;
    nocFilter: NoCType | null;
    fabricEventsFilter: EVENT_TYPE_FILTER;
    dimmed: boolean;
    zoom: number;
    onSelectLink: (linkUtilization: LinkUtilization, index: number) => void;
    onClearSelection: () => void;
}

const passesFilters = (
    linkUtilization: LinkUtilization,
    nocFilter: NoCType | null,
    fabricEventsFilter: EVENT_TYPE_FILTER,
): boolean => {
    const nocOk = nocFilter === null || linkUtilization[NPE_LINK.NOC_ID].indexOf(nocFilter) === 0;
    if (!nocOk) {
        return false;
    }
    const scope = linkUtilization[NPE_LINK.FABRIC_EVENT_SCOPE];
    if (fabricEventsFilter === EVENT_TYPE_FILTER.FABRIC_EVENTS) {
        return scope === FABRIC_EVENT_SCOPE_OPTIONS.FABRIC || scope === FABRIC_EVENT_SCOPE_OPTIONS.BOTH;
    }
    if (fabricEventsFilter === EVENT_TYPE_FILTER.LOCAL_EVENTS) {
        return scope === FABRIC_EVENT_SCOPE_OPTIONS.LOCAL || scope === FABRIC_EVENT_SCOPE_OPTIONS.BOTH;
    }
    return true;
};

const ROTATE_RE = /rotate\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)/;

const drawLink = (ctx: CanvasRenderingContext2D, points: LinkPoints, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(points.x1, points.y1);
    ctx.lineTo(points.x2, points.y2);
    ctx.stroke();

    const [p1, p2, p3] = [points.arrow.p1, points.arrow.p2, points.arrow.p3].map((p) => {
        const [x, y] = p.split(',');
        return [Number(x), Number(y)] as const;
    });

    ctx.save();
    const rotate = ROTATE_RE.exec(points.transform);
    if (rotate) {
        const [, angle, cx, cy] = rotate;
        ctx.translate(Number(cx), Number(cy));
        ctx.rotate((Number(angle) * Math.PI) / 180);
        ctx.translate(-Number(cx), -Number(cy));
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
};

const ChipCongestionCanvas = ({
    links,
    gridWidth,
    gridHeight,
    isFabricMode,
    altCongestionColors,
    nocFilter,
    fabricEventsFilter,
    dimmed,
    zoom,
    onSelectLink,
    onClearSelection,
}: ChipCongestionCanvasProps) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const cssWidth = gridWidth * CELL_STRIDE - GAP;
    const cssHeight = gridHeight * CELL_STRIDE - GAP;

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) {
            return;
        }

        // Backing store is inflated by dpr × zoom so the raster stays crisp under
        // the parent's CSS `zoom`; the CSS box stays in pre-zoom tile units.
        const scale = (window.devicePixelRatio || 1) * zoom;
        canvas.width = Math.max(1, Math.round(cssWidth * scale));
        canvas.height = Math.max(1, Math.round(cssHeight * scale));
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        ctx.globalAlpha = dimmed ? DIMMED_ALPHA : 1;
        ctx.font = LABEL_FONT;
        ctx.textBaseline = 'top';

        links.forEach(({ linkUtilization }) => {
            if (!passesFilters(linkUtilization, nocFilter, fabricEventsFilter)) {
                return;
            }
            const color = isFabricMode
                ? calculateFabricColor(linkUtilization[NPE_LINK.FABRIC_EVENT_SCOPE])
                : calculateLinkCongestionColor(linkUtilization[NPE_LINK.DEMAND], 0, altCongestionColors);
            const originX = linkUtilization[NPE_LINK.X] * CELL_STRIDE;
            const originY = linkUtilization[NPE_LINK.Y] * CELL_STRIDE;

            ctx.save();
            ctx.translate(originX, originY);
            drawLink(ctx, getLinkPoints(linkUtilization[NPE_LINK.NOC_ID], color), color);
            ctx.fillStyle = LABEL_COLOR;
            ctx.fillText(`${linkUtilization[NPE_LINK.Y]}-${linkUtilization[NPE_LINK.X]}`, 1, 1);
            ctx.restore();
        });
    }, [links, cssWidth, cssHeight, isFabricMode, altCongestionColors, nocFilter, fabricEventsFilter, dimmed, zoom]);

    const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        // rect reflects the on-screen (zoomed) size; scale the pointer offset back
        // into tile-space so the hit-test matches the CSS grid the canvas replaced.
        const localX = ((event.clientX - rect.left) / rect.width) * cssWidth;
        const localY = ((event.clientY - rect.top) / rect.height) * cssHeight;
        const cellX = Math.floor(localX / CELL_STRIDE);
        const cellY = Math.floor(localY / CELL_STRIDE);

        // Multiple NoC links can stack on one cell; the last drawn is the topmost,
        // so match the old grid where the last-mounted tile caught the click.
        let hit: ChipLink | null = null;
        links.forEach((link) => {
            if (
                link.linkUtilization[NPE_LINK.X] === cellX &&
                link.linkUtilization[NPE_LINK.Y] === cellY &&
                passesFilters(link.linkUtilization, nocFilter, fabricEventsFilter)
            ) {
                hit = link;
            }
        });

        if (hit) {
            onSelectLink((hit as ChipLink).linkUtilization, (hit as ChipLink).index);
        } else {
            onClearSelection();
        }
    };

    return (
        <canvas
            ref={canvasRef}
            className='congestion-canvas'
            style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }}
            onClick={handleClick}
        />
    );
};

export default ChipCongestionCanvas;
