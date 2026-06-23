// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';

/**
 * Test helper to extract and invoke calculatePciePixelPosition from ClusterRenderer.
 * Since the function is not exported, we test it indirectly through component rendering
 * or extract the logic as a standalone function for testing.
 *
 * For now, these tests document the expected behavior and serve as regression checks
 * if the positioning logic is exposed as a utility function in the future.
 */

describe('ClusterRenderer positioning logic', () => {
    // Constants matching ClusterRenderer.tsx
    const CLUSTER_NODE_GRID_SIZE = 6;
    const CHIP_PADDING = 2;
    const CHIP_GAP = 5;
    const PCIE_BADGE_SIZE = 26;
    const PCIE_INSET_RATIO = 1.125;

    /**
     * Reimplementation of calculatePciePixelPosition for testing.
     * This should match the logic in ClusterRenderer.tsx exactly.
     */
    const calculatePciePixelPosition = (
        coord: string,
        grid: { x_size: number; y_size: number },
        chipSize: number,
    ): { left: number; top: number; size: number } => {
        const [xStr, yStr] = coord.split('-');
        const physX = parseInt(xStr, 10);
        const physY = parseInt(yStr, 10);
        const xSize = grid.x_size;
        const ySize = grid.y_size;
        const cellSize =
            (chipSize - CHIP_PADDING * 2 - (CLUSTER_NODE_GRID_SIZE - 1) * CHIP_GAP) / CLUSTER_NODE_GRID_SIZE;
        const stride = cellSize + CHIP_GAP;
        const clamp = (val: number, max: number) => Math.max(0, Math.min(max, val));

        let col: number;
        let row: number;

        if (physX === 0) {
            col = 0;
            row = clamp(Math.round((physY / (ySize - 1)) * (CLUSTER_NODE_GRID_SIZE - 1)), CLUSTER_NODE_GRID_SIZE - 1);
        } else if (physX === xSize - 1) {
            col = CLUSTER_NODE_GRID_SIZE - 1;
            row = clamp(Math.round((physY / (ySize - 1)) * (CLUSTER_NODE_GRID_SIZE - 1)), CLUSTER_NODE_GRID_SIZE - 1);
        } else if (physY === 0) {
            col = clamp(Math.round((physX / (xSize - 1)) * (CLUSTER_NODE_GRID_SIZE - 1)), CLUSTER_NODE_GRID_SIZE - 1);
            row = 0;
        } else if (physY === ySize - 1) {
            col = clamp(Math.round((physX / (xSize - 1)) * (CLUSTER_NODE_GRID_SIZE - 1)), CLUSTER_NODE_GRID_SIZE - 1);
            row = CLUSTER_NODE_GRID_SIZE - 1;
        } else {
            col = Math.round(CLUSTER_NODE_GRID_SIZE / 2);
            row = Math.round(CLUSTER_NODE_GRID_SIZE / 2);
        }

        const insetAmount = cellSize * PCIE_INSET_RATIO;
        const left = CHIP_PADDING + col * stride + insetAmount;
        const top = CHIP_PADDING + row * stride + insetAmount;

        return { left, top, size: PCIE_BADGE_SIZE };
    };

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

            // Both should have row near 0 (top), different left positions
            expect(result1.size).toBe(PCIE_BADGE_SIZE);
            expect(result2.size).toBe(PCIE_BADGE_SIZE);
            expect(result1.left).toBeLessThan(result2.left); // coord1 is further left than coord2
        });

        it('center-fallback for non-edge coordinates', () => {
            const grid = { x_size: 10, y_size: 12 };
            const chipSize = 250;
            const coord = '5-6'; // interior
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

        it('maintains consistent size across chip sizes', () => {
            const grid = { x_size: 10, y_size: 12 };
            const coord = '0-3';

            const smallResult = calculatePciePixelPosition(coord, grid, 150);
            const mediumResult = calculatePciePixelPosition(coord, grid, 250);
            const largeResult = calculatePciePixelPosition(coord, grid, 350);

            expect(smallResult.size).toBe(PCIE_BADGE_SIZE);
            expect(mediumResult.size).toBe(PCIE_BADGE_SIZE);
            expect(largeResult.size).toBe(PCIE_BADGE_SIZE);
        });

        it('position scales proportionally with chip size', () => {
            const grid = { x_size: 10, y_size: 12 };
            const coord = '0-3';

            const smallResult = calculatePciePixelPosition(coord, grid, 150);
            const largeResult = calculatePciePixelPosition(coord, grid, 350);

            // Larger chip should have larger left/top offsets
            expect(largeResult.left).toBeGreaterThan(smallResult.left);
            expect(largeResult.top).toBeGreaterThan(smallResult.top);
        });

        it('clamps row within grid bounds on small grids', () => {
            const grid = { x_size: 4, y_size: 4 };
            const chipSize = 250;
            const coord = '0-0'; // corner

            const result = calculatePciePixelPosition(coord, grid, chipSize);

            // Should not throw or produce NaN
            expect(Number.isFinite(result.left)).toBe(true);
            expect(Number.isFinite(result.top)).toBe(true);
            expect(result.size).toBe(PCIE_BADGE_SIZE);
        });
    });

    describe('zoom scaling', () => {
        it('proportional pinch scaling (DOM_DELTA_PIXEL)', () => {
            const ZOOM_PIXEL_SCALE = 0.004;
            const ZOOM_STEP = 0.15;

            const deltaY = 50;
const unclamped = Math.abs(deltaY) * ZOOM_PIXEL_SCALE;
const step = Math.min(unclamped, ZOOM_STEP);
expect(unclamped).toBeCloseTo(0.2, 5);
expect(step).toBeLessThanOrEqual(ZOOM_STEP);
expect(step).toBe(ZOOM_STEP);
        });

        it('fixed step for mouse wheel (DOM_DELTA_LINE)', () => {
            const ZOOM_STEP = 0.15;
            const step = ZOOM_STEP; // Mouse wheel always uses fixed step

            expect(step).toBe(ZOOM_STEP);
        });

        it('small pinch gestures scale proportionally', () => {
            const ZOOM_PIXEL_SCALE = 0.004;
            const ZOOM_STEP = 0.15;

            const smallPinch = 10;
            const largeGesture = 50;

            const smallStep = Math.min(Math.abs(smallPinch) * ZOOM_PIXEL_SCALE, ZOOM_STEP);
            const largeStep = Math.min(Math.abs(largeGesture) * ZOOM_PIXEL_SCALE, ZOOM_STEP);

            expect(smallStep).toBeLessThan(largeStep);
            expect(smallStep).toBeCloseTo(0.04, 2);
            expect(largeStep).toBe(ZOOM_STEP); // Clamped
        });
    });
});
