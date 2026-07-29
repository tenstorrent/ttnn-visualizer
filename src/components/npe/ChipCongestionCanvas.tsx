// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { MouseEvent, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    EVENT_TYPE_FILTER,
    FABRIC_EVENT_SCOPE_OPTIONS,
    LinkUtilization,
    NPE_LINK,
    NoCType,
} from '../../model/NPEModel';
import {
    NODE_SIZE,
    calculateFabricColor,
    calculateLinkCongestionColor,
    drawLinkToCanvas,
    getLinkPoints,
} from './drawingApi';

// One canvas per chip in place of a DOM tile (button + SVG + label) per link_demand
// row, of which a busy timestep has hundreds. #1803

const GAP = 1; // matches `.tensix-grid { gap: 1px }`
const CELL_STRIDE = NODE_SIZE + GAP;
const LABEL_FONT = '9px sans-serif';
const LABEL_COLOR = 'rgba(255, 255, 255, 0.85)';
const DIMMED_ALPHA = 0.15;
// Ceiling on the backing store's linear scale. The raster is inflated by
// devicePixelRatio × the on-screen scale of the enclosing cluster, and that scale
// follows a zoom slider that reaches 2 — uncapped, an 8-chip Blackhole cluster at
// dpr 2 / zoom 2 wants ~542 MB of canvas, past the point where the browser starts
// discarding buffers and chips render blank. Capping trades slight softness when
// zoomed in for a bounded allocation, and it also stops most of the churn: above
// the cap the backing store stops changing size at all, so zooming no longer
// reallocates it. #1803
const MAX_BACKING_SCALE = 2;
// One frame at 60Hz — long enough that the pointer events of a single frame share
// one layout read, short enough that a moved element is re-measured immediately.
const RECT_CACHE_MS = 16;

export interface ChipLink {
    linkUtilization: LinkUtilization;
    index: number;
}

interface Cell {
    x: number;
    y: number;
}

interface ChipCongestionCanvasProps {
    links: readonly ChipLink[];
    gridWidth: number;
    gridHeight: number;
    isFabricMode: boolean;
    altCongestionColors: boolean;
    nocFilter: NoCType | null;
    fabricEventsFilter: EVENT_TYPE_FILTER;
    dimmed: boolean;
    onSelectLink: (linkUtilization: LinkUtilization, index: number) => void;
    onClearSelection: () => void;
}

const cellKey = (x: number, y: number): string => `${x}-${y}`;

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

const ChipCongestionCanvas = ({
    links,
    gridWidth,
    gridHeight,
    isFabricMode,
    altCongestionColors,
    nocFilter,
    fabricEventsFilter,
    dimmed,
    onSelectLink,
    onClearSelection,
}: ChipCongestionCanvasProps) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const hoverRef = useRef<HTMLDivElement | null>(null);
    const hoveredCellRef = useRef<Cell | null>(null);
    // Pointer hit-testing needs the canvas's on-screen box. Reading it per
    // mousemove forces a synchronous layout flush, which is expensive while
    // playback is dirtying layout every frame — so cache it and drop the cache
    // only when it can actually have moved.
    const rectRef = useRef<DOMRect | null>(null);
    const rectReadAtRef = useRef(0);
    const cssWidth = gridWidth * CELL_STRIDE - GAP;
    const cssHeight = gridHeight * CELL_STRIDE - GAP;

    // The enclosing cluster is scaled with CSS `zoom`, so the only honest source
    // for "how big is a tile on screen" is the element itself. Measuring here
    // instead of taking the ancestor's zoom as a prop keeps one source of truth —
    // the same one hit-testing uses — and stays correct if the cluster is ever
    // scaled by some other mechanism.
    const [onScreenScale, setOnScreenScale] = useState(1);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }
        const measure = () => {
            const rect = canvas.getBoundingClientRect();
            const next = rect.width > 0 ? rect.width / cssWidth : 1;
            // Epsilon-guarded so sub-pixel jitter can't drive a render loop.
            setOnScreenScale((previous) => (Math.abs(previous - next) < 0.001 ? previous : next));
        };
        measure();
        if (typeof window.ResizeObserver !== 'function') {
            return undefined;
        }
        // Feature-detected immediately above, and the initial `measure()` already ran,
        // so a browser without it just keeps the measured-once scale.
        // eslint-disable-next-line compat/compat
        const observer = new window.ResizeObserver(measure);
        observer.observe(canvas);
        return () => observer.disconnect();
    }, [cssWidth]);

    // Read the box at most once per frame's worth of pointer events. Each read forces
    // a synchronous layout flush, and a pointer move fires several times per frame on
    // a high-refresh display while playback is already dirtying layout. A short time
    // budget rather than a `requestAnimationFrame` expiry on purpose: the box can move
    // without resizing (a scroll, or a panel opening beside the cluster) and no resize
    // signal reports that, while a paint-driven expiry would never fire in a tab that
    // isn't painting. This bounds staleness without enumerating every layout shift.
    const rectForThisFrame = useCallback((canvas: HTMLCanvasElement): DOMRect => {
        const now = performance.now();
        if (!rectRef.current || now - rectReadAtRef.current > RECT_CACHE_MS) {
            rectRef.current = canvas.getBoundingClientRect();
            rectReadAtRef.current = now;
        }
        return rectRef.current;
    }, []);

    const scale = Math.min((window.devicePixelRatio || 1) * onScreenScale, MAX_BACKING_SCALE);
    const deviceWidth = Math.max(1, Math.round(cssWidth * scale));
    const deviceHeight = Math.max(1, Math.round(cssHeight * scale));

    // Single source for "which links are visible": the paint loop and the
    // hit-test index are built from the same filtered, ordered list, so what you
    // click is necessarily what you see. Filtering twice invited them to drift.
    const visibleLinks = useMemo(
        () => links.filter((link) => passesFilters(link.linkUtilization, nocFilter, fabricEventsFilter)),
        [links, nocFilter, fabricEventsFilter],
    );

    // Cell → topmost visible link. Last write wins, matching the paint order, so a
    // stack of NoC links resolves to the one drawn on top. Built once per data or
    // filter change so hover and click are O(1).
    const linksByCell = useMemo(() => {
        const byCell = new Map<string, ChipLink>();
        visibleLinks.forEach((link) => {
            byCell.set(cellKey(link.linkUtilization[NPE_LINK.X], link.linkUtilization[NPE_LINK.Y]), link);
        });
        return byCell;
    }, [visibleLinks]);

    // Hover feedback is a positioned element, not a canvas layer: it is a single
    // 1px border, so a full-grid second backing store bought nothing. Moved via a
    // ref rather than state — routing pointer position through React would
    // re-render the owning view on every mousemove, which is the churn #1803
    // removes.
    const showHover = useCallback((cell: Cell | null) => {
        const element = hoverRef.current;
        if (!element) {
            return;
        }
        if (!cell) {
            element.style.display = 'none';
            return;
        }
        element.style.display = 'block';
        element.style.transform = `translate(${cell.x * CELL_STRIDE}px, ${cell.y * CELL_STRIDE}px)`;
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) {
            return;
        }

        // The backing store is sized declaratively via the width/height attributes,
        // so React only reallocates it when the geometry genuinely changes. This
        // transform lets the drawing below stay in logical (pre-scale) tile units.
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        ctx.globalAlpha = dimmed ? DIMMED_ALPHA : 1;
        ctx.font = LABEL_FONT;
        ctx.textBaseline = 'top';

        visibleLinks.forEach(({ linkUtilization }) => {
            const color = isFabricMode
                ? calculateFabricColor(linkUtilization[NPE_LINK.FABRIC_EVENT_SCOPE])
                : calculateLinkCongestionColor(linkUtilization[NPE_LINK.DEMAND], 0, altCongestionColors);
            const originX = linkUtilization[NPE_LINK.X] * CELL_STRIDE;
            const originY = linkUtilization[NPE_LINK.Y] * CELL_STRIDE;

            ctx.save();
            ctx.translate(originX, originY);
            drawLinkToCanvas(ctx, getLinkPoints(linkUtilization[NPE_LINK.NOC_ID]), color);
            ctx.fillStyle = LABEL_COLOR;
            ctx.fillText(`${linkUtilization[NPE_LINK.Y]}-${linkUtilization[NPE_LINK.X]}`, 1, 1);
            ctx.restore();
        });
    }, [visibleLinks, cssWidth, cssHeight, isFabricMode, altCongestionColors, dimmed, scale]);

    // Only cells carrying a link are hoverable — the old markup only mounted a tile,
    // and so only showed a border, where there was one.
    const hoverableCell = useCallback(
        (cell: Cell | null) => (cell && linksByCell.has(cellKey(cell.x, cell.y)) ? cell : null),
        [linksByCell],
    );

    // A scrub swaps the links under a stationary pointer. `hoveredCellRef` holds
    // wherever the pointer actually is — not whether that cell was hoverable — so
    // hoverability can be re-derived here: the marker disappears when its link goes
    // away and appears when one arrives, neither needing the pointer to move.
    useEffect(() => {
        showHover(hoverableCell(hoveredCellRef.current));
    }, [hoverableCell, showHover]);

    const cellFromEvent = useCallback(
        (event: MouseEvent<HTMLCanvasElement>): Cell | null => {
            const canvas = canvasRef.current;
            if (!canvas) {
                return null;
            }
            const rect = rectForThisFrame(canvas);
            if (rect.width === 0 || rect.height === 0) {
                return null;
            }
            // rect is the on-screen (scaled) box; scale the pointer offset back into
            // tile space so the hit-test matches the grid the canvas replaced.
            const localX = ((event.clientX - rect.left) / rect.width) * cssWidth;
            const localY = ((event.clientY - rect.top) / rect.height) * cssHeight;
            return { x: Math.floor(localX / CELL_STRIDE), y: Math.floor(localY / CELL_STRIDE) };
        },
        [cssWidth, cssHeight, rectForThisFrame],
    );

    const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
        const cell = cellFromEvent(event);
        const hit = cell ? linksByCell.get(cellKey(cell.x, cell.y)) : undefined;

        if (hit) {
            onSelectLink(hit.linkUtilization, hit.index);
        } else {
            onClearSelection();
        }
    };

    const handleMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
        const cell = cellFromEvent(event);
        const { current } = hoveredCellRef;
        if (cell?.x === current?.x && cell?.y === current?.y) {
            return; // still the same cell — nothing to repaint
        }
        hoveredCellRef.current = cell;
        showHover(hoverableCell(cell));
    };

    const handleMouseLeave = () => {
        if (hoveredCellRef.current === null) {
            return;
        }
        hoveredCellRef.current = null;
        showHover(null);
    };

    return (
        <>
            <canvas
                ref={canvasRef}
                className='congestion-canvas'
                width={deviceWidth}
                height={deviceHeight}
                style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }}
                onClick={handleClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
            />
            <div
                ref={hoverRef}
                className='congestion-hover'
                style={{ width: `${NODE_SIZE}px`, height: `${NODE_SIZE}px` }}
            />
        </>
    );
};

// Every prop is a primitive, a referentially stable callback, or a per-chip bucket.
// The bucket arrays are rebuilt each scrub, so chips carrying links still re-render
// (their canvas genuinely needs repainting); what this skips is the idle chips,
// which share a single empty-bucket constant and so keep their prop identity.
export default memo(ChipCongestionCanvas);
