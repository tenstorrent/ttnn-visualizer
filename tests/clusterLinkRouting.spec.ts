// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    GridCell,
    MAX_ROUTED_PORTS_PER_EDGE,
    ROUTE_LANE_CLEARANCE,
    ROUTE_LANE_PITCH,
    RoutedLinkInput,
    buildRoutePaths,
    getFreeRows,
    planRoutes,
} from '../src/functions/clusterLinkRouting';
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

        expect(plans.get('0-8')).toMatchObject({ kind: 'column', edgeA: LEFT, edgeB: LEFT, side: 'left' });
        expect(planRoutes([link(GROUPED, 3, 11)], GROUPED, GROUPED_ROWS, 4).plans.get('3-11')).toMatchObject({
            edgeA: RIGHT,
            edgeB: RIGHT,
            side: 'right',
        });
    });

    it('sends an interior-column span through the blank row beside each end', () => {
        const { plans } = planRoutes([link(GROUPED, 1, 9), link(GROUPED, 6, 14)], GROUPED, GROUPED_ROWS, 4);

        expect(plans.get('1-9')).toEqual({ kind: 'column', edgeA: TOP, edgeB: TOP, side: 'left', rowA: 1, rowB: 4 });
        // Chip 6 is a bottom-row chip; the gutter is below it. Column 2 of 4 goes right.
        expect(plans.get('6-14')).toMatchObject({ edgeA: BOTTOM, edgeB: BOTTOM, side: 'right', rowA: 4, rowB: 7 });
    });

    it('flags the trailing row only when a route uses it', () => {
        expect(planRoutes([link(GROUPED, 1, 9)], GROUPED, GROUPED_ROWS, 4).needsTrailingRow).toBe(false);
        expect(planRoutes([link(GROUPED, 6, 14)], GROUPED, GROUPED_ROWS, 4).needsTrailingRow).toBe(true);
    });

    it('draws a span with nothing between its ends as a straight line', () => {
        // Chip 4 and chip 8 face each other across the gutter.
        const { plans } = planRoutes([link(GROUPED, 8, 4)], GROUPED, GROUPED_ROWS, 4);

        expect(plans.get('8-4')).toEqual({ kind: 'straight', edgeA: TOP, edgeB: BOTTOM });
    });

    it('moves to the next edge once one holds its share of ports', () => {
        const links = Array.from({ length: MAX_ROUTED_PORTS_PER_EDGE + 1 }, (_, i) => link(GROUPED, 0, 8, `c${i}`));
        const { plans } = planRoutes(links, GROUPED, GROUPED_ROWS, 4);

        expect(plans.get(`c${MAX_ROUTED_PORTS_PER_EDGE - 1}`)).toMatchObject({ edgeA: LEFT });
        expect(plans.get(`c${MAX_ROUTED_PORTS_PER_EDGE}`)).toMatchObject({ edgeA: TOP, rowA: 1 });
    });

    it('routes a same-row span through one blank row shared by both ends', () => {
        const { plans } = planRoutes([link(GROUPED, 0, 2)], GROUPED, GROUPED_ROWS, 4);

        expect(plans.get('0-2')).toEqual({ kind: 'row', edgeA: TOP, edgeB: TOP, freeRow: 1 });
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
        plan: { kind: 'column', edgeA: LEFT, edgeB: LEFT, side: 'left' },
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

    it('keeps runs from the rows either side of a blank row in separate halves', () => {
        // Chip 9's link rises into the gutter (row 4) from below; chip 5's descends into it from above.
        const { pathById } = buildRoutePaths(
            [
                {
                    id: 'up',
                    pairKey: 'up',
                    plan: { kind: 'column', edgeA: TOP, edgeB: TOP, side: 'left', rowA: 1, rowB: 4 },
                    portA: { x: 192, y: 2 * STRIDE + 2, edge: TOP },
                    portB: { x: 192, y: 5 * STRIDE + 2, edge: TOP },
                },
                {
                    id: 'down',
                    pairKey: 'down',
                    plan: { kind: 'column', edgeA: BOTTOM, edgeB: BOTTOM, side: 'left', rowA: 4, rowB: 7 },
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
