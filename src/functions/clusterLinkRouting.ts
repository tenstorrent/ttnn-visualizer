// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { CLUSTER_ETH_POSITION } from '../model/ClusterModel';
import { CLUSTER_NODE_GRID_SIZE } from './clusterPositioning';

// Orthogonal routing for condensed-layout links that span more than one cell. A bezier
// between two ports drew those links straight over every chip between them, because the
// columns are only `CHIP_GAP` apart and leave no channel to run in. These routes instead
// leave through a blank row (the top pad, a group gutter, a host gutter, or one trailing
// row) and run down a lane outside the grid edge. #1951

/** Ports an edge holds cleanly: `getEthGridPosition` lays them out between the edge's two
 * corner cells. A routed edge stops taking ports here, and pass 2 avoids filling past it. */
export const MAX_PORTS_PER_EDGE = CLUSTER_NODE_GRID_SIZE - 2;
/** Spacing between neighbouring lanes, inside a blank row and outside the grid. */
export const ROUTE_LANE_PITCH = 6;
/** Distance from the grid edge, or from a chip edge, to the nearest lane. */
export const ROUTE_LANE_CLEARANCE = 12;

export interface GridCell {
    key: string;
    x: number;
    y: number;
}

export interface RoutingLinkInput {
    /** Unique per channel link; routes and plans are keyed by it. */
    id: string;
    a: GridCell;
    b: GridCell;
}

/** The side of the grid a column route's outside lane runs down. */
export type RouteSide = CLUSTER_ETH_POSITION.LEFT | CLUSTER_ETH_POSITION.RIGHT;

export type RoutePlan =
    // Nothing sits between the two cells, so the direct line is already clear.
    | { kind: 'straight'; edgeA: CLUSTER_ETH_POSITION; edgeB: CLUSTER_ETH_POSITION }
    // Same row: both ends step into the same blank row, run across it and step back.
    | { kind: 'row'; edgeA: CLUSTER_ETH_POSITION; edgeB: CLUSTER_ETH_POSITION; freeRow: number }
    // Same column: each end reaches the lane on `side`, directly or through the blank row
    // given for that end (`null` when its port opens straight onto the lane).
    | {
          kind: 'column';
          edgeA: CLUSTER_ETH_POSITION;
          edgeB: CLUSTER_ETH_POSITION;
          side: RouteSide;
          rowA: number | null;
          rowB: number | null;
      };

export interface RoutingPlan {
    plans: Map<string, RoutePlan>;
    /** A route uses the row below the last one, so the caller has to add it to the grid. */
    needsTrailingRow: boolean;
}

const cellId = (x: number, y: number) => `${x},${y}`;

// The integers strictly between `from` and `to`, ascending.
const rangeBetween = (from: number, to: number) => Array.from({ length: to - from - 1 }, (_, i) => from + 1 + i);

/**
 * @description Rows below `totalRows` that hold no chip, plus `totalRows` itself, which the
 * caller adds as a trailing row when a route needs it. A horizontal run crosses the whole row,
 * so a row counts only when every cell in it is empty, not just the one beside the chip.
 */
export const getFreeRows = (cells: GridCell[], totalRows: number): Set<number> => {
    const occupiedRows = new Set(cells.map((cell) => cell.y));
    const free = new Set<number>();
    for (let row = 0; row <= totalRows; row += 1) {
        if (!occupiedRows.has(row)) {
            free.add(row);
        }
    }
    return free;
};

/**
 * @description Decides how each spanning link is routed and which chip edge each end's port
 * sits on. Both ends are decided together, which per-chip edge picking cannot do: picking the
 * edge that faced the partner on one end and an outward one on the other is what sent
 * `0 ↔ 8` back up the column through chip 4.
 *
 * A link that cannot be routed — a diagonal, an interior row with no blank row beside it, or
 * every candidate edge full — is left out, and the caller keeps its curve.
 */
export const planRoutes = (
    links: RoutingLinkInput[],
    cells: GridCell[],
    totalRows: number,
    totalCols: number,
): RoutingPlan => {
    const occupied = new Set(cells.map((cell) => cellId(cell.x, cell.y)));
    const freeRows = getFreeRows(cells, totalRows);
    const portCountByEdgeKey = new Map<string, number>();
    const plans = new Map<string, RoutePlan>();
    let needsTrailingRow = false;

    const edgeKey = (cell: GridCell, edge: CLUSTER_ETH_POSITION) => `${cell.key}:${edge}`;
    const hasRoom = (cell: GridCell, edge: CLUSTER_ETH_POSITION) =>
        (portCountByEdgeKey.get(edgeKey(cell, edge)) ?? 0) < MAX_PORTS_PER_EDGE;
    const claim = (cell: GridCell, edge: CLUSTER_ETH_POSITION, row: number | null = null) => {
        portCountByEdgeKey.set(edgeKey(cell, edge), (portCountByEdgeKey.get(edgeKey(cell, edge)) ?? 0) + 1);
        if (row === totalRows) {
            needsTrailingRow = true;
        }
    };

    // Nothing sits between the two cells, so the direct line is already clear: `near` is the
    // nearer cell's edge facing the other, `far` the other's facing back. Edges stay in a/b order.
    const tryStraight = (
        id: string,
        a: GridCell,
        b: GridCell,
        near: GridCell,
        nearEdge: CLUSTER_ETH_POSITION,
        farEdge: CLUSTER_ETH_POSITION,
    ) => {
        const far = near === a ? b : a;
        if (hasRoom(near, nearEdge) && hasRoom(far, farEdge)) {
            claim(near, nearEdge);
            claim(far, farEdge);
            const [edgeA, edgeB] = near === a ? [nearEdge, farEdge] : [farEdge, nearEdge];
            plans.set(id, { kind: 'straight', edgeA, edgeB });
        }
    };

    // The blank row an end steps into through `edge`, when there is one.
    const rowThrough = (cell: GridCell, edge: CLUSTER_ETH_POSITION): number | null => {
        if (edge === CLUSTER_ETH_POSITION.TOP && freeRows.has(cell.y - 1)) {
            return cell.y - 1;
        }
        if (edge === CLUSTER_ETH_POSITION.BOTTOM && freeRows.has(cell.y + 1)) {
            return cell.y + 1;
        }
        return null;
    };

    for (const { id, a, b } of links) {
        if (a.x === b.x && a.y !== b.y) {
            const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
            const isClear = !rangeBetween(upper.y, lower.y).some((y) => occupied.has(cellId(a.x, y)));

            if (isClear) {
                tryStraight(id, a, b, upper, CLUSTER_ETH_POSITION.BOTTOM, CLUSTER_ETH_POSITION.TOP);
            } else {
                const side: RouteSide = a.x < totalCols / 2 ? CLUSTER_ETH_POSITION.LEFT : CLUSTER_ETH_POSITION.RIGHT;
                const isOuterColumn = side === CLUSTER_ETH_POSITION.LEFT ? a.x === 0 : a.x === totalCols - 1;
                // An outer-column chip opens straight onto the lane; anything else steps
                // into a blank row first.
                const candidates = [
                    ...(isOuterColumn ? [side] : []),
                    CLUSTER_ETH_POSITION.TOP,
                    CLUSTER_ETH_POSITION.BOTTOM,
                ];
                const pick = (cell: GridCell) =>
                    candidates.find(
                        (edge) => hasRoom(cell, edge) && (edge === side || rowThrough(cell, edge) !== null),
                    );
                const edgeA = pick(a);
                const edgeB = pick(b);
                if (edgeA !== undefined && edgeB !== undefined) {
                    const rowA = rowThrough(a, edgeA);
                    const rowB = rowThrough(b, edgeB);
                    claim(a, edgeA, rowA);
                    claim(b, edgeB, rowB);
                    plans.set(id, { kind: 'column', edgeA, edgeB, side, rowA, rowB });
                }
            }
        } else if (a.y === b.y && a.x !== b.x) {
            const [left, right] = a.x < b.x ? [a, b] : [b, a];
            const isClear = !rangeBetween(left.x, right.x).some((x) => occupied.has(cellId(x, a.y)));

            if (isClear) {
                tryStraight(id, a, b, left, CLUSTER_ETH_POSITION.RIGHT, CLUSTER_ETH_POSITION.LEFT);
            } else {
                // Both ends must use the same blank row, so the edge is chosen for the pair.
                const edge = [CLUSTER_ETH_POSITION.TOP, CLUSTER_ETH_POSITION.BOTTOM].find(
                    (candidate) => rowThrough(a, candidate) !== null && hasRoom(a, candidate) && hasRoom(b, candidate),
                );
                if (edge !== undefined) {
                    // The `find` above only accepts an edge with a blank row through it.
                    const freeRow = rowThrough(a, edge)!;
                    claim(a, edge, freeRow);
                    claim(b, edge, freeRow);
                    plans.set(id, { kind: 'row', edgeA: edge, edgeB: edge, freeRow });
                }
            }
        }
    }

    return { plans, needsTrailingRow };
};

export interface RoutePort {
    x: number;
    y: number;
    edge: CLUSTER_ETH_POSITION;
}

export interface RoutedLinkInput {
    id: string;
    /** Links sharing a pair key are channels of one connection, and get neighbouring lanes. */
    pairKey: string;
    plan: RoutePlan;
    portA: RoutePort;
    portB: RoutePort;
}

export interface RouteGeometry {
    stride: number;
    chipSize: number;
    contentWidth: number;
}

export interface RoutePaths {
    /** SVG `d` per link id. */
    pathById: Map<string, string>;
    /** Room each side of the grid needs for its outside lanes; 0 when none are used. */
    margin: number;
}

interface Interval {
    start: number;
    end: number;
}

/**
 * @description Greedy interval colouring: each interval takes the lowest lane no interval
 * already in it comes within `separation` of. Callers sort shortest first, so a span nested
 * inside another lands on an inner lane and the two never cross.
 */
const assignLanes = <T extends Interval>(intervals: T[], separation: number): Map<T, number> => {
    const lanes: Interval[][] = [];
    const laneOf = new Map<T, number>();
    for (const interval of intervals) {
        let lane = lanes.findIndex((members) =>
            members.every(
                (member) => interval.start > member.end + separation || interval.end < member.start - separation,
            ),
        );
        if (lane === -1) {
            lane = lanes.length;
            lanes.push([]);
        }
        lanes[lane].push(interval);
        laneOf.set(interval, lane);
    }
    return laneOf;
};

const toPath = (points: [number, number][]) =>
    points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');

/**
 * @description Turns route plans into SVG paths once port pixels are known.
 *
 * Each blank row is split in half: runs from the row above use the upper half and runs from
 * the row below the lower half, so a stub rising from one row never cuts a run leaving the
 * other. Within a half, shorter runs sit nearer the chips. Outside lanes are shared between
 * links whose vertical spans do not come close, with longer spans further out.
 */
export const buildRoutePaths = (links: RoutedLinkInput[], geometry: RouteGeometry): RoutePaths => {
    const { stride, chipSize, contentWidth } = geometry;
    const sideX = (side: RouteSide) => (side === CLUSTER_ETH_POSITION.LEFT ? 0 : contentWidth);

    // Step 1: horizontal runs inside blank rows, keyed by row and half.
    interface Run extends Interval {
        id: string;
        endpoint: 'a' | 'b';
        row: number;
        fromBelow: boolean;
    }
    const runsByHalf = new Map<string, Run[]>();
    const addRun = (run: Run) => {
        const halfKey = `${run.row}:${run.fromBelow ? 'lower' : 'upper'}`;
        const runs = runsByHalf.get(halfKey) ?? [];
        runs.push(run);
        runsByHalf.set(halfKey, runs);
    };

    for (const { id, plan, portA, portB } of links) {
        if (plan.kind === 'row') {
            addRun({
                id,
                endpoint: 'a',
                row: plan.freeRow,
                fromBelow: plan.edgeA === CLUSTER_ETH_POSITION.TOP,
                start: Math.min(portA.x, portB.x),
                end: Math.max(portA.x, portB.x),
            });
        } else if (plan.kind === 'column') {
            const edgeX = sideX(plan.side);
            (
                [
                    ['a', portA, plan.rowA],
                    ['b', portB, plan.rowB],
                ] as const
            ).forEach(([endpoint, port, row]) => {
                if (row !== null) {
                    addRun({
                        id,
                        endpoint,
                        row,
                        fromBelow: port.edge === CLUSTER_ETH_POSITION.TOP,
                        start: Math.min(port.x, edgeX),
                        end: Math.max(port.x, edgeX),
                    });
                }
            });
        }
    }

    const runY = new Map<string, number>();
    runsByHalf.forEach((runs) => {
        const sorted = [...runs].sort((runA, runB) => runA.end - runA.start - (runB.end - runB.start));
        const laneOf = assignLanes(sorted, ROUTE_LANE_PITCH);
        const laneCount = Math.max(...laneOf.values()) + 1;
        const half = chipSize / 2;
        const pitch = Math.min(ROUTE_LANE_PITCH, (half - ROUTE_LANE_CLEARANCE) / laneCount);
        sorted.forEach((run) => {
            const lane = laneOf.get(run)!;
            const rowTop = run.row * stride;
            const y = run.fromBelow
                ? rowTop + chipSize - ROUTE_LANE_CLEARANCE - lane * pitch
                : rowTop + ROUTE_LANE_CLEARANCE + lane * pitch;
            runY.set(`${run.id}:${run.endpoint}`, y);
        });
    });

    // Step 2: vertical lanes outside the grid, one set per side.
    interface Span extends Interval {
        link: RoutedLinkInput;
        side: RouteSide;
        yA: number;
        yB: number;
    }
    const spansBySide = new Map<RouteSide, Span[]>();
    for (const link of links) {
        if (link.plan.kind === 'column') {
            const yA = runY.get(`${link.id}:a`) ?? link.portA.y;
            const yB = runY.get(`${link.id}:b`) ?? link.portB.y;
            const { side } = link.plan;
            const spans = spansBySide.get(side) ?? [];
            spans.push({ link, side, yA, yB, start: Math.min(yA, yB), end: Math.max(yA, yB) });
            spansBySide.set(side, spans);
        }
    }

    let laneCountMax = 0;
    const laneXById = new Map<string, number>();
    spansBySide.forEach((spans, side) => {
        // Shortest first, compared in whole strides so a pair's channels stay consecutive.
        const sorted = [...spans].sort(
            (spanA, spanB) =>
                Math.round((spanA.end - spanA.start) / stride) - Math.round((spanB.end - spanB.start) / stride) ||
                spanA.link.pairKey.localeCompare(spanB.link.pairKey) ||
                spanA.link.id.localeCompare(spanB.link.id),
        );
        // Spans that only touch would read as one line, so keep them half a stride apart.
        const laneOf = assignLanes(sorted, stride / 2);
        sorted.forEach((span) => {
            const offset = ROUTE_LANE_CLEARANCE + laneOf.get(span)! * ROUTE_LANE_PITCH;
            laneXById.set(span.link.id, side === CLUSTER_ETH_POSITION.LEFT ? -offset : contentWidth + offset);
        });
        laneCountMax = Math.max(laneCountMax, Math.max(...laneOf.values()) + 1);
    });

    // Step 3: paths.
    const pathById = new Map<string, string>();
    for (const { id, plan, portA, portB } of links) {
        if (plan.kind === 'straight') {
            pathById.set(
                id,
                toPath([
                    [portA.x, portA.y],
                    [portB.x, portB.y],
                ]),
            );
        } else if (plan.kind === 'row') {
            const y = runY.get(`${id}:a`)!;
            pathById.set(
                id,
                toPath([
                    [portA.x, portA.y],
                    [portA.x, y],
                    [portB.x, y],
                    [portB.x, portB.y],
                ]),
            );
        } else {
            const laneX = laneXById.get(id)!;
            const yA = runY.get(`${id}:a`);
            const yB = runY.get(`${id}:b`);
            pathById.set(
                id,
                toPath([
                    [portA.x, portA.y],
                    ...(yA === undefined ? [] : [[portA.x, yA] as [number, number]]),
                    [laneX, yA ?? portA.y],
                    [laneX, yB ?? portB.y],
                    ...(yB === undefined ? [] : [[portB.x, yB] as [number, number]]),
                    [portB.x, portB.y],
                ]),
            );
        }
    }

    const margin = laneCountMax === 0 ? 0 : 2 * ROUTE_LANE_CLEARANCE + (laneCountMax - 1) * ROUTE_LANE_PITCH;
    return { pathById, margin };
};
