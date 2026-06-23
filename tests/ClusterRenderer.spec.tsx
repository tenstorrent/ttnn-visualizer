// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    CHIP_GAP,
    CHIP_PADDING,
    CLUSTER_NODE_GRID_SIZE,
    PCIE_BADGE_SIZE,
    PCIE_INSET_RATIO,
    ZOOM_PIXEL_SCALE,
    ZOOM_STEP,
    calculatePciePixelPosition,
} from '../src/functions/clusterPositioning';

describe('calculatePciePixelPosition', () => {
    it('maps left-edge coordinate to column 0', () => {
        const grid = { x_size: 10, y_size: 12 };
        const chipSize = 250;
        const coord = '0-3';
        const result = calculatePciePixelPosition(coord, grid, chipSize);

        expect(result.size).toBe(PCIE_BADGE_SIZE);
        expect(result.left).toBeGreaterThanOrEqual(CHIP_PADDING);
        expect(result.top).toBeGreaterThan(0);
    });

    it('maps right-edge coordinate to final column', () => {
        const grid = { x_size: 10, y_size: 12 };
        const chipSize = 250;
        const coord = '9-6'; // right edge, middle height
        const result = calculatePciePixelPosition(coord, grid, chipSize);

        const cellSize =
            (chipSize - CHIP_PADDING * 2 - (CLUSTER_NODE_GRID_SIZE - 1) * CHIP_GAP) / CLUSTER_NODE_GRID_SIZE;
        const stride = cellSize + CHIP_GAP;
        const expectedBaseLeft = CHIP_PADDING + (CLUSTER_NODE_GRID_SIZE - 1) * stride;

        expect(result.size).toBe(PCIE_BADGE_SIZE);
        expect(result.left).toBeGreaterThan(expectedBaseLeft);
    });

    it('handles top-edge coordinates on blackhole', () => {
        const grid = { x_size: 17, y_size: 12 };
        const chipSize = 250;
        const coord1 = '2-0';
        const coord2 = '11-0';

        const result1 = calculatePciePixelPosition(coord1, grid, chipSize);
        const result2 = calculatePciePixelPosition(coord2, grid, chipSize);

        // Both on top row; coord2 maps further right
        expect(result1.size).toBe(PCIE_BADGE_SIZE);
        expect(result2.size).toBe(PCIE_BADGE_SIZE);
        expect(result1.left).toBeLessThan(result2.left);
    });

    it('center-fallback for non-edge coordinates', () => {
        const grid = { x_size: 10, y_size: 12 };
        const chipSize = 250;
        const coord = '5-6'; // interior — not on any edge
        const result = calculatePciePixelPosition(coord, grid, chipSize);

        const cellSize =
            (chipSize - CHIP_PADDING * 2 - (CLUSTER_NODE_GRID_SIZE - 1) * CHIP_GAP) / CLUSTER_NODE_GRID_SIZE;
        const stride = cellSize + CHIP_GAP;
        const centerCol = Math.round(CLUSTER_NODE_GRID_SIZE / 2);
        const centerRow = Math.round(CLUSTER_NODE_GRID_SIZE / 2);
        const insetAmount = cellSize * PCIE_INSET_RATIO;
        const expectedLeft = CHIP_PADDING + centerCol * stride + insetAmount;
        const expectedTop = CHIP_PADDING + centerRow * stride + insetAmount;

        expect(result.left).toBeCloseTo(expectedLeft, 0);
        expect(result.top).toBeCloseTo(expectedTop, 0);
        expect(result.size).toBe(PCIE_BADGE_SIZE);
    });

    it('maintains consistent badge size across chip sizes', () => {
        const grid = { x_size: 10, y_size: 12 };
        const coord = '0-3';

        expect(calculatePciePixelPosition(coord, grid, 150).size).toBe(PCIE_BADGE_SIZE);
        expect(calculatePciePixelPosition(coord, grid, 250).size).toBe(PCIE_BADGE_SIZE);
        expect(calculatePciePixelPosition(coord, grid, 350).size).toBe(PCIE_BADGE_SIZE);
    });

    it('position scales proportionally with chip size', () => {
        const grid = { x_size: 10, y_size: 12 };
        const coord = '0-3';

        const smallResult = calculatePciePixelPosition(coord, grid, 150);
        const largeResult = calculatePciePixelPosition(coord, grid, 350);

        // Larger chip → more pixel space → larger offsets
        expect(largeResult.left).toBeGreaterThan(smallResult.left);
        expect(largeResult.top).toBeGreaterThan(smallResult.top);
    });

    it('clamps row within grid bounds on small grids', () => {
        const grid = { x_size: 4, y_size: 4 };
        const chipSize = 250;
        const coord = '0-0'; // corner

        const result = calculatePciePixelPosition(coord, grid, chipSize);

        expect(Number.isFinite(result.left)).toBe(true);
        expect(Number.isFinite(result.top)).toBe(true);
        expect(result.size).toBe(PCIE_BADGE_SIZE);
    });
});

describe('zoom step scaling', () => {
    it('proportional pinch scaling is clamped to ZOOM_STEP', () => {
        // deltaY=50 → unclamped 0.2, clamped to ZOOM_STEP
        const unclamped = Math.abs(50) * ZOOM_PIXEL_SCALE;
        const step = Math.min(unclamped, ZOOM_STEP);

        expect(unclamped).toBeCloseTo(0.2, 5);
        expect(step).toBe(ZOOM_STEP);
    });

    it('small pinch gestures produce proportionally smaller steps', () => {
        const smallStep = Math.min(Math.abs(10) * ZOOM_PIXEL_SCALE, ZOOM_STEP);
        const largeStep = Math.min(Math.abs(50) * ZOOM_PIXEL_SCALE, ZOOM_STEP);

        expect(smallStep).toBeLessThan(largeStep);
        expect(smallStep).toBeCloseTo(0.04, 2);
        expect(largeStep).toBe(ZOOM_STEP);
    });
});
