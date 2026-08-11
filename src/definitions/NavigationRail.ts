// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { CSSProperties, ReactNode } from 'react';

/**
 * Upper bound on the dots one rail draws.
 *
 * A rail spans the scrolling list, which is 600px tall (`.scrollable-element`
 * in `BufferSummaryPlot.scss`), so past roughly one dot per two pixels the dots
 * overlap into a bar nobody can click and every extra one is a popover the
 * virtualized list reconciles on each scroll tick. Rails whose findings are
 * bounded by the report coalesce down to this; top-N is already bounded by
 * `TOP_N_COUNT_MAX`.
 */
export const RAIL_MAX_DOTS = 300;

export interface NavigationRailItem {
    key: string | number;
    /** Position in the rendered row list: places the dot, and is what a click scrolls to. */
    rowIndex: number;
    /** Hover text, also used to build the dot's accessible name. */
    tooltip: string;
    /** Modifier carrying the finding's colour; the shared geometry is `.rail-dot`. */
    dotClassName: string;
    dotTestId: string;
    dotStyle?: CSSProperties;
    /** Glyph or numeral drawn inside the dot. */
    content: ReactNode;
}
