// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Summarises a per-timestep series down to one value per drawn column for the NPE
// timeline heat bar. Each column takes the MAX of the steps it covers so an
// isolated congestion spike survives being summarised — a mean or a last-wins
// reduction averages spikes into invisibility, which is the opposite of what a
// congestion bar is for. Drawing one rect per timestep instead was both far slower
// and lossy: at 196k steps the rects were ~0.008px wide, so every screen pixel was
// written hundreds of times and only the blended result survived. #1803
//
// Pure and colour-free on purpose: the palette is applied per column by the
// caller, so switching colour schemes doesn't rescan the whole series.
export default function reduceToColumns(
    values: readonly (number | undefined)[],
    columnCount: number,
): (number | undefined)[] {
    const dataSize = values.length;
    if (columnCount <= 0 || dataSize === 0) {
        return [];
    }

    const columns: (number | undefined)[] = [];
    for (let col = 0; col < columnCount; col++) {
        const start = Math.floor((col * dataSize) / columnCount);
        // Always cover at least one step so a column can't come out empty when
        // columnCount and dataSize are close.
        const end = Math.min(dataSize, Math.max(start + 1, Math.floor(((col + 1) * dataSize) / columnCount)));

        let max: number | undefined;
        for (let i = start; i < end; i++) {
            const value = values[i];
            if (value !== undefined && (max === undefined || value > max)) {
                max = value;
            }
        }
        columns.push(max);
    }
    return columns;
}
