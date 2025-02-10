import { NoCID } from '../../model/NPEModel';

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

export interface LinkPoints {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    arrow: { p1: string; p2: string; p3: string };
    transform: string;
    color?: string;
    colors?: string[];
    nocId: NoCID;
}

const colorList: string[] = [
    '#FFFFFF', // White
    '#FF0000', // Red
    '#0000FF', // Blue
    '#FFFF00', // Yellow
    '#FF00FF', // Fuchsia
    '#FF4500', // OrangeRed
    'rgb(91,131,19)',
    '#9400D3', // DarkViolet
    '#FFD700', // Gold
    '#1E90FF', // DodgerBlue
    '#007500', // LimeGreen
    '#FF69B4', // HotPink
    '#BA55D3', // MediumOrchid
    '#7FFF00', // Chartreuse
    '#B22222', // FireBrick
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
export const getRouteColor = (transferId: number): string => {
    if (!routeColorMap.has(transferId)) {
        routeColorMap.set(transferId, getNextColor.next().value);
    }
    return routeColorMap.get(transferId) || '#ffffff';
};

export const getLinkPoints = (nocId: NoCID, color?: string): LinkPoints => {
    let x1: number = 0;
    let x2: number = 0;
    let y1: number = 0;
    let y2: number = 0;

    let arrowHeadHeight = 9;
    let arrowHeadWidth = 9;

    let transform = '';
    let angle = 0;

    let arrowOffset = 0;
    let arrow = { p1: '', p2: '', p3: '' };
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
                p1: `${x2 - arrowHeadWidth / 2},${y2 + arrowHeadHeight + arrowOffset}`,
                p2: `${x2 + arrowHeadWidth / 2},${y2 + arrowHeadHeight + arrowOffset}`,
                p3: `${x2},${y2 + arrowOffset}`,
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
                p1: `${x2 + arrowHeadHeight + arrowOffset},${y2 - arrowHeadWidth / 2}`,
                p2: `${x2 + arrowHeadHeight + arrowOffset},${y2 + arrowHeadWidth / 2}`,
                p3: `${x2 + arrowOffset},${y2}`,
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
                p1: `${x2 - arrowHeadWidth / 2},${y2 - arrowHeadHeight - arrowOffset}`,
                p2: `${x2 + arrowHeadWidth / 2},${y2 - arrowHeadHeight - arrowOffset}`,
                p3: `${x2},${y2 - arrowOffset}`,
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
                p1: `${x2 - arrowHeadHeight - arrowOffset},${y2 - arrowHeadWidth / 2}`,
                p2: `${x2 - arrowHeadHeight - arrowOffset},${y2 + arrowHeadWidth / 2}`,
                p3: `${x2 - arrowOffset},${y2}`,
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
                p1: `${x2 - arrowHeadWidth / 2},${y2 + arrowHeadHeight - arrowOffset}`,
                p2: `${x2 + arrowHeadWidth / 2},${y2 + arrowHeadHeight - arrowOffset}`,
                p3: `${x2},${y2 - arrowOffset}`,
            };
            angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90;
            transform = `rotate(${angle} ${x2} ${y2})`;

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
                p1: `${x2 - arrowHeadWidth / 2},${y2 + arrowHeadHeight - arrowOffset}`,
                p2: `${x2 + arrowHeadWidth / 2},${y2 + arrowHeadHeight - arrowOffset}`,
                p3: `${x2},${y2 - arrowOffset}`,
            };
            angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90;
            transform = `rotate(${angle} ${x2} ${y2})`;
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
                p1: `${x2 - arrowHeadWidth / 2},${y2 + arrowHeadHeight - arrowOffset}`,
                p2: `${x2 + arrowHeadWidth / 2},${y2 + arrowHeadHeight - arrowOffset}`,
                p3: `${x2},${y2 - arrowOffset}`,
            };
            angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90;

            transform = `rotate(${angle} ${x2} ${y2})`;

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
                p1: `${x2 - arrowHeadWidth / 2},${y2 + arrowHeadHeight - arrowOffset}`,
                p2: `${x2 + arrowHeadWidth / 2},${y2 + arrowHeadHeight - arrowOffset}`,
                p3: `${x2},${y2 - arrowOffset}`,
            };
            angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90;

            transform = `rotate(${angle} ${x2} ${y2})`;

            break;
        default:
            // console.warn('Unknown link type', nocId);
            break;
    }
    return { x2, y2, x1, y1, arrow, transform, color, nocId } as LinkPoints;
};
export const calculateLinkCongestionColor = (value: number, min: number = 0, isHC: boolean = false): string => {
    if (value === -1) {
        return `rgb(100, 100, 100)`;
    }
    const max = 150;
    const normalizedVal = Math.min(value, max);
    const ratio = (normalizedVal - min) / (max - min);
    const intensity = Math.round(ratio * 255);
    if (isHC) {
        return `rgb(${intensity},${intensity},${255 - intensity})`;
    }

    return `rgb(${intensity}, ${255 - intensity}, 0)`;
};
