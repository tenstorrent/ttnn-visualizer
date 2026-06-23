// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export const CLUSTER_NODE_GRID_SIZE = 6;
export const CHIP_PADDING = 2; // keep in sync with ClusterView.scss `.chip { padding: 2px; }`
export const CHIP_GAP = 5;
export const PCIE_BADGE_SIZE = 26; // Not too large but readable

// Inset factor for PCIe badge positioning: multiplied by cellSize to place badges
// ~1.125 cells inward from grid corners. Balances visibility and avoids overlaps.
export const PCIE_INSET_RATIO = 1.125;

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.15;
export const ZOOM_PIXEL_SCALE = 0.004;

export const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

/**
 * Maps a physical PCIe coordinate ("x-y" from the arch JSON) to pixel offsets
 * within the chip container. Uses the same cell geometry as the ETH grid so
 * the badge lands at the equivalent visual position without participating in
 * grid layout (which would risk displacing ETH elements).
 * PCIe is inset toward the chip center to avoid overlapping edge-positioned ETH ports.
 */
export const calculatePciePixelPosition = (
    coord: string,
    grid: { x_size: number; y_size: number },
    chipSize: number,
): { left: number; top: number; size: number } => {
    const [xStr, yStr] = coord.split('-');
    const physX = parseInt(xStr, 10);
    const physY = parseInt(yStr, 10);
    const xSize = grid.x_size;
    const ySize = grid.y_size;
    const cellSize = (chipSize - CHIP_PADDING * 2 - (CLUSTER_NODE_GRID_SIZE - 1) * CHIP_GAP) / CLUSTER_NODE_GRID_SIZE;
    const stride = cellSize + CHIP_GAP;
    const clamp = (val: number, max: number) => Math.max(0, Math.min(max, val));

    // Determine which edge and map the along-edge physical coord to a 0-based
    // grid index within CLUSTER_NODE_GRID_SIZE cells.
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
        // Interior coordinate (shouldn't occur in practice): center as fallback.
        col = Math.round(CLUSTER_NODE_GRID_SIZE / 2);
        row = Math.round(CLUSTER_NODE_GRID_SIZE / 2);
    }

    // Inset the PCIe badge significantly toward the center to avoid overlapping
    // with edge-positioned ETH ports (which occupy the perimeter cells).
    const insetAmount = cellSize * PCIE_INSET_RATIO;
    const left = CHIP_PADDING + col * stride + insetAmount;
    const top = CHIP_PADDING + row * stride + insetAmount;

    return { left, top, size: PCIE_BADGE_SIZE };
};
