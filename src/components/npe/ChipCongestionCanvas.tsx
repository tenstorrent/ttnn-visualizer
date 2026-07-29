// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { MouseEvent, memo, useCallback, useEffect, useMemo, useRef } from 'react';
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
// $tt-yellow-tint-2 — the border the old `.tensix:hover` rule drew on link tiles.
const HOVER_COLOR = '#f5e2ba';

const cellKey = (x: number, y: number): string => `${x}-${y}`;

// Assigning `canvas.width`/`height` reallocates and zeroes the whole backing store
// (and forces a GPU re-upload) even when the value is unchanged — ~2.8 MB per chip
// at dpr 2, so ~22 MB of pointless churn per scrub across an 8-chip cluster. Resize
// only on a real geometry change; callers still clear explicitly. #1803.
const resizeCanvas = (canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, scale: number): void => {
    const width = Math.max(1, Math.round(cssWidth * scale));
    const height = Math.max(1, Math.round(cssHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
};

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
    const hoverCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const hoveredCellRef = useRef<{ x: number; y: number } | null>(null);
    const cssWidth = gridWidth * CELL_STRIDE - GAP;
    const cssHeight = gridHeight * CELL_STRIDE - GAP;

    // Backing store is inflated by dpr × zoom so the raster stays crisp under
    // the parent's CSS `zoom`; the CSS box stays in pre-zoom tile units.
    const scale = (window.devicePixelRatio || 1) * zoom;

    // Cell → topmost link that passes the current filters. Built once per data or
    // filter change so hover (which fires on every pointer move) and click both
    // resolve in O(1) instead of rescanning every link. Last write wins, matching
    // the draw order where the last link painted is the visible one.
    const linksByCell = useMemo(() => {
        const byCell = new Map<string, ChipLink>();
        links.forEach((link) => {
            if (passesFilters(link.linkUtilization, nocFilter, fabricEventsFilter)) {
                byCell.set(cellKey(link.linkUtilization[NPE_LINK.X], link.linkUtilization[NPE_LINK.Y]), link);
            }
        });
        return byCell;
    }, [links, nocFilter, fabricEventsFilter]);

    // Paints (or clears) the hover border on its own layer, so following the
    // pointer costs one 1px rect instead of redrawing the chip's whole
    // congestion layer. Called imperatively from the pointer handlers — routing
    // the hovered cell through state would re-render NPEView on every mousemove,
    // which is exactly the churn #1803 is removing.
    const paintHover = useCallback(
        (cell: { x: number; y: number } | null) => {
            const canvas = hoverCanvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (!canvas || !ctx) {
                return;
            }
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.clearRect(0, 0, cssWidth, cssHeight);
            if (!cell) {
                return;
            }
            // Half-pixel inset keeps the 1px stroke on the pixel grid instead of
            // straddling two rows, mirroring the old CSS border-box edge.
            ctx.strokeStyle = HOVER_COLOR;
            ctx.lineWidth = 1;
            ctx.strokeRect(cell.x * CELL_STRIDE + 0.5, cell.y * CELL_STRIDE + 0.5, NODE_SIZE - 1, NODE_SIZE - 1);
        },
        [scale, cssWidth, cssHeight],
    );

    // Resize the hover layer alongside the base canvas. A resize also clears it, so
    // drop any stale hover: the pointer may now be over a different cell, and the
    // next move repaints anyway.
    useEffect(() => {
        const canvas = hoverCanvasRef.current;
        if (!canvas) {
            return;
        }
        resizeCanvas(canvas, cssWidth, cssHeight, scale);
        hoveredCellRef.current = null;
    }, [cssWidth, cssHeight, scale]);

    // A scrub swaps the links under a stationary pointer, so a border left on a
    // cell that no longer has one would be a lie. Re-resolve the held cell
    // against the new data instead of waiting for the next pointer move.
    useEffect(() => {
        const cell = hoveredCellRef.current;
        if (cell && !linksByCell.has(cellKey(cell.x, cell.y))) {
            hoveredCellRef.current = null;
        }
        paintHover(hoveredCellRef.current);
    }, [linksByCell, paintHover]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) {
            return;
        }

        resizeCanvas(canvas, cssWidth, cssHeight, scale);
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
    }, [links, cssWidth, cssHeight, isFabricMode, altCongestionColors, nocFilter, fabricEventsFilter, dimmed, scale]);

    const cellFromEvent = useCallback(
        (event: MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
            const canvas = canvasRef.current;
            if (!canvas) {
                return null;
            }
            const rect = canvas.getBoundingClientRect();
            // rect reflects the on-screen (zoomed) size; scale the pointer offset back
            // into tile-space so the hit-test matches the CSS grid the canvas replaced.
            const localX = ((event.clientX - rect.left) / rect.width) * cssWidth;
            const localY = ((event.clientY - rect.top) / rect.height) * cssHeight;
            return { x: Math.floor(localX / CELL_STRIDE), y: Math.floor(localY / CELL_STRIDE) };
        },
        [cssWidth, cssHeight],
    );

    const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
        const cell = cellFromEvent(event);
        // Multiple NoC links can stack on one cell; `linksByCell` holds the last
        // one drawn, matching the old grid where the last-mounted tile caught the
        // click.
        const hit = cell ? linksByCell.get(cellKey(cell.x, cell.y)) : undefined;

        if (hit) {
            onSelectLink(hit.linkUtilization, hit.index);
        } else {
            onClearSelection();
        }
    };

    const handleMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
        const cell = cellFromEvent(event);
        // Only cells that actually carry a link are hoverable — the old markup only
        // mounted a tile (and so only showed a border) where there was one.
        const target = cell && linksByCell.has(cellKey(cell.x, cell.y)) ? cell : null;
        const { current } = hoveredCellRef;
        if (target?.x === current?.x && target?.y === current?.y) {
            return; // same cell (or still nothing) — nothing to repaint
        }
        hoveredCellRef.current = target;
        paintHover(target);
    };

    const handleMouseLeave = () => {
        if (hoveredCellRef.current === null) {
            return;
        }
        hoveredCellRef.current = null;
        paintHover(null);
    };

    return (
        <>
            <canvas
                ref={canvasRef}
                className='congestion-canvas'
                style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }}
                onClick={handleClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
            />
            <canvas
                ref={hoverCanvasRef}
                className='congestion-canvas congestion-canvas--hover'
                style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }}
            />
        </>
    );
};

// Every prop is either a primitive, a referentially stable callback, or a per-chip
// bucket that only changes when that chip's data does — so on a scrub that leaves a
// chip idle this skips the subtree entirely instead of re-rendering two canvases
// per chip across the cluster.
export default memo(ChipCongestionCanvas);
