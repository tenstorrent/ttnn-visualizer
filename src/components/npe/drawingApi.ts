import { NoCID } from '../../model/NPE';

export const NODE_SIZE = 70;

const NOC_CENTER = { x: 40, y: NODE_SIZE - 40 };
const CENTER_DISPERSION = 10; // dispersion from the starting point
const NOC_0_X_OFFSET = -CENTER_DISPERSION;
const NOC_0_Y_OFFSET = -CENTER_DISPERSION;
const NOC_1_X_OFFSET = CENTER_DISPERSION;
const NOC_1_Y_OFFSET = CENTER_DISPERSION;
const CORE_CENTER = { x: NODE_SIZE - 20, y: 20 };
// const CORE_DISPERSION = 2;

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
    color?: string;
}

export const getLinkPoints = (linkName: NoCID, color?: string) => {
    let x1: number = 0;
    let x2: number = 0;
    let y1: number = 0;
    let y2: number = 0;

    const arrowHeadHeight = 9;
    const arrowHeadWidth = 9;

    let arrowOffset = 10;
    // const transform = '';

    let arrow = { p1: '', p2: '', p3: '' };
    // const arrowSecondary = { p1: '', p2: '', p3: '' };

    switch (linkName) {
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
            arrowOffset = 0;
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
            arrowOffset = 0;
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
        default:
            console.warn('Unknown link type', linkName);
            break;
    }
    return { x2, y2, x1, y1, arrow, color };
};
// export const drawLink = (
//     selector: never,
//     linkName: NoCID,
//     color?: string,
//     stroke: number = 1,
// ) => {
//     const {
//         //
//         lineEndX,
//         lineEndY,
//         lineStartX,
//         lineStartY,
//         arrow,
//         arrowSecondary,
//         transform,
//     } = getLinkPoints(linkName);
//
//     /** DEBUGGING FOR COLOR FUNCTION */
//     // const getColor = () => {
//     //     if (direction.includes('noc0')) {
//     //         return direction.includes('_in') ? '#ff0000' : '#ff6600';
//     //     }
//     //     if (direction.includes('noc1')) {
//     //         return direction.includes('_in') ? '#0000ff' : '#0066ff';
//     //     }
//     // };
//
//     // Draw line
//     selector
//         .append('line')
//         .attr('x1', lineStartX)
//         .attr('y1', lineStartY)
//         .attr('x2', lineEndX)
//         .attr('y2', lineEndY)
//         .attr('stroke-width', stroke)
//         .attr('stroke', color || '#4d4d4d');
//
//     // arrowhead
//
//         selector
//             // keeping this here for the prettier
//             .append('polygon')
//             .attr('points', `${arrow.p1} ${arrow.p2} ${arrow.p3}`)
//             .attr('transform', transform)
//             .attr('fill', color || '#7e7e7e');
//
//     if (
//         linkName === NOC2AXILinkName.NOC0_NOC2AXI ||
//         NOC2AXILinkName.NOC1_NOC2AXI ||
//         DramBankLinkName.DRAM_INOUT ||
//         PCIeLinkName.PCIE_INOUT
//     ) {
//         selector
//             //
//             .append('polygon')
//             .attr('points', `${arrowSecondary.p1} ${arrowSecondary.p2} ${arrowSecondary.p3}`)
//             .attr('transform', transform)
//             .attr('fill', color || '#7e7e7e');
//     }
// };
