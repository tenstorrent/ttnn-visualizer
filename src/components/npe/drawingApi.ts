// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FABRIC_EVENT_SCOPE_OPTIONS, FabricEventScopeColors, NoCID } from '../../model/NPEModel';

export const NODE_SIZE = 50;

const NOC_CENTER = { x: 25, y: NODE_SIZE - 25 };
const CENTER_DISPERSION = 5; // dispersion from the starting point
const NOC_0_X_OFFSET = -CENTER_DISPERSION;
const NOC_0_Y_OFFSET = -CENTER_DISPERSION;
const NOC_1_X_OFFSET = CENTER_DISPERSION;
const NOC_1_Y_OFFSET = CENTER_DISPERSION;
const CORE_CENTER = { x: NODE_SIZE - 10, y: 10 };
const CORE_DISPERSION = 2;

export const NOC_CONFIGURATION = {
    noc0: { x: NOC_CENTER.x + NOC_0_X_OFFSET, y: NOC_CENTER.y + NOC_0_Y_OFFSET },
    noc1: { x: NOC_CENTER.x + NOC_1_X_OFFSET, y: NOC_CENTER.y + NOC_1_Y_OFFSET },
    core: { x: CORE_CENTER.x, y: CORE_CENTER.y },
};

export interface Point {
    x: number;
    y: number;
}

// Geometry is numeric so both renderers can consume it directly: the SVG path
// stringifies at the edge (`TensixTransferRenderer`), the canvas path uses the
// numbers as-is. It used to be stored pre-formatted for SVG, which forced the
// canvas to `split(',')` the points and regex-parse `rotate(a cx cy)` back into
// numbers on every link of every repaint — a string contract between two modules
// that no type or test could hold. #1803
export interface LinkPoints {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    arrow: { p1: Point; p2: Point; p3: Point };
    rotation: { angle: number; cx: number; cy: number } | null;
    color?: string;
    colors?: string[];
    nocId: NoCID;
}

// `points="x,y x,y x,y"` for an SVG <polygon>.
export const formatArrowPoints = ({ p1, p2, p3 }: LinkPoints['arrow']): string =>
    `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;

// `transform="rotate(angle cx cy)"` for an SVG element, or undefined when the
// link needs no rotation.
export const formatRotation = (rotation: LinkPoints['rotation']): string | undefined =>
    rotation ? `rotate(${rotation.angle} ${rotation.cx} ${rotation.cy})` : undefined;

// Canvas twin of the SVG <line> + <polygon> pair `TensixTransferRenderer` emits.
// Lives here so both renderers of the same geometry sit side by side. #1803
export const drawLinkToCanvas = (ctx: CanvasRenderingContext2D, points: LinkPoints, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(points.x1, points.y1);
    ctx.lineTo(points.x2, points.y2);
    ctx.stroke();

    const { p1, p2, p3 } = points.arrow;
    ctx.save();
    if (points.rotation) {
        const { angle, cx, cy } = points.rotation;
        ctx.translate(cx, cy);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.translate(-cx, -cy);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
};

const colorList: string[] = [
    '#FFFFFF',
    '#FF0000',
    '#0000FF',
    '#FFFF00',
    '#FF00FF',
    '#FF4500',
    '#5B8313',
    '#9400D3',
    '#FFD700',
    '#1E90FF',
    '#007500',
    '#FF69B4',
    '#BA55D3',
    '#7FFF00',
    '#B22222',
];

function* colorGenerator(): IterableIterator<string> {
    let i = 0;
    while (true) {
        yield colorList[i]!;
        i = (i + 1) % colorList.length;
    }
}

const getNextColor = colorGenerator();
const routeColorMap = new Map<number, string>();
export const getRouteColor = (transferId: number | null): string => {
    const DEFAULT_COLOR = '#ffffff';
    if (transferId === null) {
        return DEFAULT_COLOR;
    }
    if (!routeColorMap.has(transferId)) {
        routeColorMap.set(transferId, getNextColor.next().value);
    }
    return routeColorMap.get(transferId) || DEFAULT_COLOR;
};
export const resetRouteColors = (): void => {
    routeColorMap.clear();
};

export const getLinkPoints = (nocId: NoCID, color?: string): LinkPoints => {
    let x1: number = 0;
    let x2: number = 0;
    let y1: number = 0;
    let y2: number = 0;

    let arrowHeadHeight = 9;
    let arrowHeadWidth = 9;

    let rotation: LinkPoints['rotation'] = null;
    let angle: number;

    let arrowOffset: number;
    let arrow = { p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } };
    // const arrowSecondary = { p1: '', p2: '', p3: '' };

    switch (nocId) {
        case NoCID.NOC1_NORTH:
            // up out
            arrowOffset = 0;
            x1 = NOC_CENTER.x + NOC_1_X_OFFSET;
            y1 = NOC_CENTER.y + NOC_1_Y_OFFSET;
            x2 = NOC_CENTER.x + NOC_1_X_OFFSET;
            y2 = 0;
            arrow = {
                p1: { x: x2 - arrowHeadWidth / 2, y: y2 + arrowHeadHeight + arrowOffset },
                p2: { x: x2 + arrowHeadWidth / 2, y: y2 + arrowHeadHeight + arrowOffset },
                p3: { x: x2, y: y2 + arrowOffset },
            };
            break;

        case NoCID.NOC1_WEST:
            // left out
            arrowOffset = 0;

            x1 = NOC_CENTER.x + NOC_1_X_OFFSET;
            x2 = 0;
            y1 = NOC_CENTER.y + NOC_1_Y_OFFSET;
            y2 = NOC_CENTER.y + NOC_1_Y_OFFSET;
            arrow = {
                p1: { x: x2 + arrowHeadHeight + arrowOffset, y: y2 - arrowHeadWidth / 2 },
                p2: { x: x2 + arrowHeadHeight + arrowOffset, y: y2 + arrowHeadWidth / 2 },
                p3: { x: x2 + arrowOffset, y: y2 },
            };

            break;

        case NoCID.NOC0_SOUTH:
            // down out
            arrowOffset = 2;
            x1 = NOC_CENTER.x + NOC_0_X_OFFSET;
            x2 = NOC_CENTER.x + NOC_0_X_OFFSET;
            y1 = NOC_CENTER.y + NOC_0_Y_OFFSET;
            y2 = NODE_SIZE;
            arrow = {
                p1: { x: x2 - arrowHeadWidth / 2, y: y2 - arrowHeadHeight - arrowOffset },
                p2: { x: x2 + arrowHeadWidth / 2, y: y2 - arrowHeadHeight - arrowOffset },
                p3: { x: x2, y: y2 - arrowOffset },
            };

            break;

        case NoCID.NOC0_EAST:
            // right out
            arrowOffset = 2;
            x1 = NOC_CENTER.x + NOC_0_X_OFFSET;
            x2 = NODE_SIZE;
            y1 = NOC_CENTER.y + NOC_0_Y_OFFSET;
            y2 = NOC_CENTER.y + NOC_0_Y_OFFSET;
            arrow = {
                p1: { x: x2 - arrowHeadHeight - arrowOffset, y: y2 - arrowHeadWidth / 2 },
                p2: { x: x2 - arrowHeadHeight - arrowOffset, y: y2 + arrowHeadWidth / 2 },
                p3: { x: x2 - arrowOffset, y: y2 },
            };
            break;
        case NoCID.NOC0_OUT:
            arrowHeadWidth = 7;
            arrowHeadHeight = 7;
            arrowOffset = 2;
            x1 = NOC_CENTER.x + NOC_0_X_OFFSET - CORE_DISPERSION;
            x2 = CORE_CENTER.x + NOC_0_X_OFFSET - CORE_DISPERSION;
            y1 = NOC_CENTER.y + NOC_0_Y_OFFSET - CORE_DISPERSION;
            y2 = CORE_CENTER.y + NOC_0_Y_OFFSET - CORE_DISPERSION;
            arrow = {
                p1: { x: x2 - arrowHeadWidth / 2, y: y2 + arrowHeadHeight - arrowOffset },
                p2: { x: x2 + arrowHeadWidth / 2, y: y2 + arrowHeadHeight - arrowOffset },
                p3: { x: x2, y: y2 - arrowOffset },
            };
            angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90;
            rotation = { angle, cx: x2, cy: y2 };

            break;
        case NoCID.NOC0_IN:
            arrowHeadWidth = 7;
            arrowHeadHeight = 7;
            arrowOffset = 2;
            x1 = CORE_CENTER.x + NOC_0_X_OFFSET + CORE_DISPERSION;
            x2 = NOC_CENTER.x + NOC_0_X_OFFSET + CORE_DISPERSION;
            y2 = NOC_CENTER.y + NOC_0_Y_OFFSET + CORE_DISPERSION;
            y1 = CORE_CENTER.y + NOC_0_Y_OFFSET + CORE_DISPERSION;
            arrow = {
                p1: { x: x2 - arrowHeadWidth / 2, y: y2 + arrowHeadHeight - arrowOffset },
                p2: { x: x2 + arrowHeadWidth / 2, y: y2 + arrowHeadHeight - arrowOffset },
                p3: { x: x2, y: y2 - arrowOffset },
            };
            angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90;
            rotation = { angle, cx: x2, cy: y2 };
            break;
        case NoCID.NOC1_OUT:
            arrowHeadWidth = 7;
            arrowHeadHeight = 7;
            arrowOffset = 0;
            x1 = NOC_CENTER.x + NOC_1_X_OFFSET - CORE_DISPERSION;
            x2 = CORE_CENTER.x + NOC_1_X_OFFSET - CORE_DISPERSION;
            y1 = NOC_CENTER.y + NOC_1_Y_OFFSET - CORE_DISPERSION;
            y2 = CORE_CENTER.y + NOC_1_Y_OFFSET - CORE_DISPERSION;
            arrow = {
                p1: { x: x2 - arrowHeadWidth / 2, y: y2 + arrowHeadHeight - arrowOffset },
                p2: { x: x2 + arrowHeadWidth / 2, y: y2 + arrowHeadHeight - arrowOffset },
                p3: { x: x2, y: y2 - arrowOffset },
            };
            angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90;

            rotation = { angle, cx: x2, cy: y2 };

            break;
        case NoCID.NOC1_IN:
            arrowHeadWidth = 7;
            arrowHeadHeight = 7;
            arrowOffset = 0;
            x1 = CORE_CENTER.x + NOC_1_X_OFFSET + CORE_DISPERSION;
            x2 = NOC_CENTER.x + NOC_1_X_OFFSET + CORE_DISPERSION;
            y2 = NOC_CENTER.y + NOC_1_Y_OFFSET + CORE_DISPERSION;
            y1 = CORE_CENTER.y + NOC_1_Y_OFFSET + CORE_DISPERSION;
            arrow = {
                p1: { x: x2 - arrowHeadWidth / 2, y: y2 + arrowHeadHeight - arrowOffset },
                p2: { x: x2 + arrowHeadWidth / 2, y: y2 + arrowHeadHeight - arrowOffset },
                p3: { x: x2, y: y2 - arrowOffset },
            };
            angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90;

            rotation = { angle, cx: x2, cy: y2 };

            break;
        default:
            // console.warn('Unknown link type', nocId);
            break;
    }
    return { x2, y2, x1, y1, arrow, rotation, color, nocId } as LinkPoints;
};
export const calculateLinkCongestionColor = (value: number, min: number = 0, isHC: boolean = false): string => {
    if (value === -1) {
        return `rgb(100, 100, 100)`;
    }
    const max = 150;
    const normalizedVal = Math.min(value, max);
    const ratio = (normalizedVal - min) / (max - min);

    if (isHC) {
        const r = Math.round(ratio * 255);
        const g = Math.round(100 + ratio * (165 - 100));
        const b = Math.round(255 - ratio * 255);
        return `rgb(${r}, ${g}, ${b})`;
    }
    const intensity = Math.round(ratio * 255);
    return `rgb(${intensity}, ${255 - intensity}, 0)`;
};

export const calculateFabricColor = (eventType: FABRIC_EVENT_SCOPE_OPTIONS | undefined): string => {
    return eventType !== undefined ? FabricEventScopeColors[eventType] : 'rgb(255,255,255)';
};
export const getLines = (nocs: Array<{ transfer: number | null; nocId: NoCID }>) => {
    return nocs.map((noc) => {
        return getLinkPoints(noc.nocId, getRouteColor(noc.transfer));
    });
};

const NPE_ZONE_ALPHA = 0.5;

const NPE_ZONE_COLOR = [
    `rgba(255, 0, 0, ${NPE_ZONE_ALPHA})`, // Red
    `rgba(0, 0, 255, ${NPE_ZONE_ALPHA})`, // Blue
    `rgba(255, 255, 0, ${NPE_ZONE_ALPHA})`, // Yellow
    `rgba(255, 0, 255, ${NPE_ZONE_ALPHA})`, // Fuchsia
    `rgba(255, 69, 0, ${NPE_ZONE_ALPHA})`, // OrangeRed
    `rgba(91, 131, 19, ${NPE_ZONE_ALPHA})`, // Olive-ish green
    `rgba(148, 0, 211, ${NPE_ZONE_ALPHA})`, // DarkViolet
    `rgba(255, 215, 0, ${NPE_ZONE_ALPHA})`, // Gold
    `rgba(30, 144, 255, ${NPE_ZONE_ALPHA})`, // DodgerBlue
    `rgba(0, 117, 0, ${NPE_ZONE_ALPHA})`, // LimeGreen
    `rgba(255, 105, 180, ${NPE_ZONE_ALPHA})`, // HotPink
    `rgba(186, 85, 211, ${NPE_ZONE_ALPHA})`, // MediumOrchid
    `rgba(127, 255, 0, ${NPE_ZONE_ALPHA})`, // Chartreuse
    `rgba(178, 34, 34, ${NPE_ZONE_ALPHA})`, // FireBrick
];

function* npeColorGenerator(): IterableIterator<string> {
    let i = 0;
    while (true) {
        yield NPE_ZONE_COLOR[i]!;
        i = (i + 1) % NPE_ZONE_COLOR.length;
    }
}

const getNextNpeColor = npeColorGenerator();
const npeColorMap = new Map<number | string, string>();
export const getNpeZoneColor = (id: number | string | null): string => {
    const DEFAULT_COLOR = `rgba(255, 255, 255, ${NPE_ZONE_ALPHA})`;
    if (id === null) {
        return DEFAULT_COLOR;
    }
    if (!npeColorMap.has(id)) {
        npeColorMap.set(id, getNextNpeColor.next().value);
    }
    return npeColorMap.get(id) || DEFAULT_COLOR;
};
