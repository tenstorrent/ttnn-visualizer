// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

const clampToRange = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * @description The op<->perf mapping is resolved against the link-pinned report
 * while the performance slider spans the rows the performance tab is currently
 * displaying, so a mapped perf id can fall outside a narrowed view (a signpost
 * window, most obviously). Keep the handles inside their own track (#1812).
 *
 * A selection that misses the track entirely widens to the whole track rather
 * than clamping, because clamping would pin both handles to the same edge and
 * `Performance.tsx` reads that as a legitimate one-row selection — the miss test
 * there is deliberately the same one. Widening keeps its existing fallback to
 * the full report intact.
 */
export const clampSelectionToRange = (
    min: number,
    max: number,
    rangeMin: number,
    rangeMax: number,
): [number, number] => {
    const missesRange = max < rangeMin || min > rangeMax;

    return missesRange
        ? [rangeMin, rangeMax]
        : [clampToRange(min, rangeMin, rangeMax), clampToRange(max, rangeMin, rangeMax)];
};
