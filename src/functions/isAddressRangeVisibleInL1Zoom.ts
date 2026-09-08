// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Half-open allocation [rangeStart, rangeEnd) vs inclusive zoom [zoomStart, zoomEnd].
 * Gap end equals the next allocation address (OperationDetails fragmentation).
 * Zoom low bound is exclusive (rangeEnd > zoomStart); high bound is inclusive (rangeStart <= zoomEnd)
 * so gaps that start on the slider max address are not dimmed.
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

    return rangeEnd > l1ZoomStart && rangeStart <= l1ZoomEnd;
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
