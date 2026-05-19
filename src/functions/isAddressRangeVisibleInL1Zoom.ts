// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Half-open [rangeStart, rangeEnd) overlap with the L1 zoom window [zoomStart, zoomEnd].
 * Matches fragmentation gaps in OperationDetails (gap end equals the next allocation address).
 * Plotly clips the x-axis to the same slider endpoints; bar/gap visibility uses this rule.
 */
export function isAddressRangeVisibleInL1Zoom(
    rangeStart: number,
    rangeEnd: number,
    l1ZoomRange: [number, number],
): boolean {
    const [l1ZoomStart, l1ZoomEnd] = l1ZoomRange;

    if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd) || rangeEnd <= rangeStart) {
        return false;
    }

    return rangeEnd > l1ZoomStart && rangeStart < l1ZoomEnd;
}

export function isAddressRangeOutOfL1Zoom(
    rangeStart: number,
    rangeEnd: number,
    l1ZoomRange?: [number, number],
): boolean {
    if (l1ZoomRange === undefined) {
        return false;
    }

    return !isAddressRangeVisibleInL1Zoom(rangeStart, rangeEnd, l1ZoomRange);
}
