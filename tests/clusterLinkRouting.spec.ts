// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    GridCell,
    ROUTE_LANE_CLEARANCE,
    ROUTE_LANE_PITCH,
    ROUTE_PLAN_KIND,
    RoutedLinkInput,
    buildRoutePaths,
    getFreeRows,
    planRoutes,
} from '../src/functions/clusterLinkRouting';
import { MAX_PORTS_PER_EDGE } from '../src/functions/clusterPositioning';
import { CLUSTER_ETH_POSITION } from '../src/model/ClusterModel';

const { TOP, BOTTOM, LEFT, RIGHT } = CLUSTER_ETH_POSITION;

/** Cells for a 4-wide grid with chips on `rows`; chip id is its index in row order. */
const gridOf = (rows: number[]): GridCell[] =>
    rows.flatMap((y, rowIndex) => Array.from({ length: 4 }, (_, x) => ({ key: `0-${rowIndex * 4 + x}`, x, y })));

// The issue's shape, cut to two groups: a two-row top pad, two rows, a gutter, two rows.
const GROUPED = gridOf([2, 3, 5, 6]);
const GROUPED_ROWS = 7;
const chip = (cells: GridCell[], id: number) => cells.find((cell) => cell.key === `0-${id}`)!;
const link = (cells: GridCell[], a: number, b: number, id = `${a}-${b}`) => ({
    id,
    a: chip(cells, a),
    b: chip(cells, b),
});

describe('getFreeRows', () => {
    it('counts only rows with no chip, plus the row below the grid', () => {
        expect([...getFreeRows(GROUPED, GROUPED_ROWS)].sort((a, b) => a - b)).toEqual([0, 1, 4, 7]);
    });
});

describe('planRoutes', () => {
    it('puts both ends of an outer-column span on the outside edge', () => {
        // 0 -> 8 crosses chip 4: the first mechanism behind #1951 put chip 8's port on TOP.
        const { plans } = planRoutes([link(GROUPED, 0, 8)], GROUPED, GROUPED_ROWS, 4);

        expect(plans.get('0-8')).toMatchObject({ kind: ROUTE_PLAN_KIND.COLUMN, edgeA: LEFT, edgeB: LEFT, side: LEFT });
        expect(planRoutes([link(GROUPED, 3, 11)], GROUPED, GROUPED_ROWS, 4).plans.get('3-11')).toMatchObject({
            edgeA: RIGHT,
            edgeB: RIGHT,
            side: RIGHT,
        });
    });

    it('sends an interior-column span through the blank row beside each end', () => {
        const { plans } = planRoutes([link(GROUPED, 1, 9), link(GROUPED, 6, 14)], GROUPED, GROUPED_ROWS, 4);

        expect(plans.get('1-9')).toEqual({
            kind: ROUTE_PLAN_KIND.COLUMN,
            edgeA: TOP,
            edgeB: TOP,
            side: LEFT,
            rowA: 1,
            rowB: 4,
        });
        // Chip 6 is a bottom-row chip; the gutter is below it. Column 2 of 4 goes right.
        expect(plans.get('6-14')).toMatchObject({ edgeA: BOTTOM, edgeB: BOTTOM, side: RIGHT, rowA: 4, rowB: 7 });
    });

    it('flags the trailing row only when a route uses it', () => {
        expect(planRoutes([link(GROUPED, 1, 9)], GROUPED, GROUPED_ROWS, 4).needsTrailingRow).toBe(false);
        expect(planRoutes([link(GROUPED, 6, 14)], GROUPED, GROUPED_ROWS, 4).needsTrailingRow).toBe(true);
    });

    it('draws a span with nothing between its ends as a straight line', () => {
        // Chip 4 and chip 8 face each other across the gutter.
        const { plans } = planRoutes([link(GROUPED, 8, 4)], GROUPED, GROUPED_ROWS, 4);

        expect(plans.get('8-4')).toEqual({ kind: ROUTE_PLAN_KIND.STRAIGHT, edgeA: TOP, edgeB: BOTTOM });
    });

    it('refuses a straight span once either facing edge is full, and lists it as unrouted', () => {
        const links = Array.from({ length: MAX_PORTS_PER_EDGE + 1 }, (_, i) => link(GROUPED, 8, 4, `s${i}`));
        const { plans, unrouted } = planRoutes(links, GROUPED, GROUPED_ROWS, 4);

        expect(plans.get(`s${MAX_PORTS_PER_EDGE - 1}`)).toMatchObject({ kind: ROUTE_PLAN_KIND.STRAIGHT });
        expect(plans.has(`s${MAX_PORTS_PER_EDGE}`)).toBe(false);
        expect([...unrouted]).toEqual([`s${MAX_PORTS_PER_EDGE}`]);
    });

    it('moves to the next edge once one holds its share of ports', () => {
        const links = Array.from({ length: MAX_PORTS_PER_EDGE + 1 }, (_, i) => link(GROUPED, 0, 8, `c${i}`));
        const { plans } = planRoutes(links, GROUPED, GROUPED_ROWS, 4);

        expect(plans.get(`c${MAX_PORTS_PER_EDGE - 1}`)).toMatchObject({ edgeA: LEFT });
        expect(plans.get(`c${MAX_PORTS_PER_EDGE}`)).toMatchObject({ edgeA: TOP, rowA: 1 });
    });

    it('routes a same-row span through one blank row shared by both ends', () => {
        const { plans } = planRoutes([link(GROUPED, 0, 2)], GROUPED, GROUPED_ROWS, 4);

        expect(plans.get('0-2')).toEqual({ kind: ROUTE_PLAN_KIND.ROW, edgeA: TOP, edgeB: TOP, freeRow: 1 });
    });

    it('routes a bottom-row span through the trailing row', () => {
        const { plans, needsTrailingRow } = planRoutes([link(GROUPED, 12, 14)], GROUPED, GROUPED_ROWS, 4);

        expect(plans.get('12-14')).toEqual({ kind: ROUTE_PLAN_KIND.ROW, edgeA: BOTTOM, edgeB: BOTTOM, freeRow: 7 });
        expect(needsTrailingRow).toBe(true);
    });

    it('moves a same-row span to the other blank row once one edge is full, then gives up', () => {
        const links = Array.from({ length: 2 * MAX_PORTS_PER_EDGE + 1 }, (_, i) => link(GROUPED, 0, 2, `r${i}`));
        const { plans } = planRoutes(links, GROUPED, GROUPED_ROWS, 4);

        // Row 1 chips: TOP opens on the top pad, BOTTOM on chip 4's row — so BOTTOM is no
        // route at all, and the pair gives up once TOP is full.
        expect(plans.get(`r${MAX_PORTS_PER_EDGE - 1}`)).toMatchObject({ edgeA: TOP, freeRow: 1 });
        expect(plans.has(`r${MAX_PORTS_PER_EDGE}`)).toBe(false);

        // Chips 4 and 6 have the gutter below them and chips 0 and 2 above: BOTTOM only.
        const lower = Array.from({ length: MAX_PORTS_PER_EDGE + 1 }, (_, i) => link(GROUPED, 4, 6, `l${i}`));
        const { plans: lowerPlans } = planRoutes(lower, GROUPED, GROUPED_ROWS, 4);
        expect(lowerPlans.get(`l${MAX_PORTS_PER_EDGE - 1}`)).toMatchObject({ edgeA: BOTTOM, freeRow: 4 });
        expect(lowerPlans.has(`l${MAX_PORTS_PER_EDGE}`)).toBe(false);
    });

    it('lists every link it offered no plan as unrouted, diagonals included', () => {
        const full = Array.from({ length: MAX_PORTS_PER_EDGE + 1 }, (_, i) => link(GROUPED, 4, 6, `l${i}`));
        const { plans, unrouted } = planRoutes(
            [link(GROUPED, 0, 5, 'diagonal'), link(GROUPED, 0, 8), ...full],
            GROUPED,
            GROUPED_ROWS,
            4,
        );

        expect([...unrouted].sort()).toEqual(['diagonal', `l${MAX_PORTS_PER_EDGE}`]);
        [...unrouted].forEach((id) => expect(plans.has(id)).toBe(false));
    });

    it('leaves a link out when no blank row is beside it', () => {
        // Id-order tiling, three rows with nothing between them: the middle row is boxed in.
        const UNGROUPED = gridOf([2, 3, 4]);
        const { plans } = planRoutes(
            [link(UNGROUPED, 4, 6), link(UNGROUPED, 5, 0), link(UNGROUPED, 1, 9)],
            UNGROUPED,
            5,
            4,
        );

        expect(plans.has('4-6')).toBe(false);
        // Diagonal.
        expect(plans.has('5-0')).toBe(false);
        expect(plans.get('1-9')).toMatchObject({ edgeA: TOP, edgeB: BOTTOM });
    });
});

describe('buildRoutePaths', () => {
    const STRIDE = 155;
    const geometry = { stride: STRIDE, chipSize: 150, contentWidth: 4 * 150 + 3 * 5 };
    const leftPort = (row: number): { x: number; y: number; edge: CLUSTER_ETH_POSITION } => ({
        x: 2,
        y: row * STRIDE + 75,
        edge: LEFT,
    });
    const columnLink = (id: string, pairKey: string, rowA: number, rowB: number): RoutedLinkInput => ({
        id,
        pairKey,
        plan: { kind: ROUTE_PLAN_KIND.COLUMN, edgeA: LEFT, edgeB: LEFT, side: LEFT, rowA: null, rowB: null },
        portA: leftPort(rowA),
        portB: leftPort(rowB),
    });
    const laneX = (path: string) => Number(path.split(' L ')[1].split(' ')[0]);

    it('gives the channels of one pair neighbouring lanes, and the longer span the outer one', () => {
        const { pathById, margin } = buildRoutePaths(
            [
                columnLink('long', '0-0|0-24', 2, 12),
                columnLink('short-0', '0-0|0-8', 2, 5),
                columnLink('short-1', '0-0|0-8', 2, 5),
            ],
            geometry,
        );

        const lanes = ['short-0', 'short-1', 'long'].map((id) => laneX(pathById.get(id)!));
        expect(lanes).toEqual([
            -ROUTE_LANE_CLEARANCE,
            -ROUTE_LANE_CLEARANCE - ROUTE_LANE_PITCH,
            -ROUTE_LANE_CLEARANCE - 2 * ROUTE_LANE_PITCH,
        ]);
        expect(margin).toBe(2 * ROUTE_LANE_CLEARANCE + 2 * ROUTE_LANE_PITCH);
    });

    it('lets spans far enough apart share a lane', () => {
        const { pathById, margin } = buildRoutePaths(
            [columnLink('upper', 'a', 2, 5), columnLink('lower', 'b', 8, 11)],
            geometry,
        );

        expect(laneX(pathById.get('upper')!)).toBe(laneX(pathById.get('lower')!));
        expect(margin).toBe(2 * ROUTE_LANE_CLEARANCE);
    });

    it('runs a same-row route along one y inside the half of the blank row nearest its chips', () => {
        const rowLink = (id: string, edge: CLUSTER_ETH_POSITION, freeRow: number, portY: number): RoutedLinkInput => ({
            id,
            pairKey: id,
            plan: { kind: ROUTE_PLAN_KIND.ROW, edgeA: edge, edgeB: edge, freeRow },
            portA: { x: 40, y: portY, edge },
            portB: { x: 350, y: portY, edge },
        });
        // TOP ports on row 2 into row 1; BOTTOM ports on row 3 into row 4.
        const { pathById } = buildRoutePaths(
            [rowLink('up', TOP, 1, 2 * STRIDE + 2), rowLink('down', BOTTOM, 4, 3 * STRIDE + 148)],
            geometry,
        );
        const vertices = (id: string) =>
            pathById
                .get(id)!
                .replace('M ', '')
                .split(' L ')
                .map((point) => point.split(' ').map(Number));

        const up = vertices('up');
        expect(up).toHaveLength(4);
        expect(up[1][1]).toBe(up[2][1]);
        // Lower half of row 1, the half next to row 2.
        expect(up[1][1]).toBeGreaterThan(1 * STRIDE + 75);
        expect(up[1][1]).toBeLessThan(1 * STRIDE + 150);

        const down = vertices('down');
        expect(down[1][1]).toBe(down[2][1]);
        // Upper half of row 4, the half next to row 3.
        expect(down[1][1]).toBeGreaterThan(4 * STRIDE);
        expect(down[1][1]).toBeLessThan(4 * STRIDE + 75);
    });

    it('squeezes the run pitch so a busy half of a blank row keeps every run inside it', () => {
        // Fifteen overlapping runs from below into row 1 need more lanes than fit at the full
        // pitch: at 6 apart the outermost would cross into the upper half.
        const runs = Array.from(
            { length: 15 },
            (_, i): RoutedLinkInput => ({
                id: `run-${i}`,
                pairKey: `run-${i}`,
                plan: { kind: ROUTE_PLAN_KIND.ROW, edgeA: TOP, edgeB: TOP, freeRow: 1 },
                portA: { x: 40, y: 2 * STRIDE + 2, edge: TOP },
                portB: { x: 350, y: 2 * STRIDE + 2, edge: TOP },
            }),
        );
        const { pathById } = buildRoutePaths(runs, geometry);
        const runYs = runs.map(({ id }) => Number(pathById.get(id)!.split(' L ')[1].split(' ')[1]));

        expect(new Set(runYs).size).toBe(runs.length);
        runYs.forEach((y) => {
            expect(y).toBeGreaterThan(1 * STRIDE + 75);
            expect(y).toBeLessThan(1 * STRIDE + 150);
        });
    });

    it('keeps runs from the rows either side of a blank row in separate halves', () => {
        // Chip 9's link rises into the gutter (row 4) from below; chip 5's descends into it from above.
        const { pathById } = buildRoutePaths(
            [
                {
                    id: 'up',
                    pairKey: 'up',
                    plan: { kind: ROUTE_PLAN_KIND.COLUMN, edgeA: TOP, edgeB: TOP, side: LEFT, rowA: 1, rowB: 4 },
                    portA: { x: 192, y: 2 * STRIDE + 2, edge: TOP },
                    portB: { x: 192, y: 5 * STRIDE + 2, edge: TOP },
                },
                {
                    id: 'down',
                    pairKey: 'down',
                    plan: { kind: ROUTE_PLAN_KIND.COLUMN, edgeA: BOTTOM, edgeB: BOTTOM, side: LEFT, rowA: 4, rowB: 7 },
                    portA: { x: 200, y: 3 * STRIDE + 148, edge: BOTTOM },
                    portB: { x: 200, y: 6 * STRIDE + 148, edge: BOTTOM },
                },
            ],
            geometry,
        );
        const gutterMid = 4 * STRIDE + 75;
        const runY = (path: string, at: number) => Number(path.split(' L ')[at].split(' ')[1]);

        // Second point of `up` is chip 9's turn into the gutter; first of `down` is chip 5's.
        expect(runY(pathById.get('up')!, 4)).toBeGreaterThan(gutterMid);
        expect(runY(pathById.get('down')!, 1)).toBeLessThan(gutterMid);
    });
});
