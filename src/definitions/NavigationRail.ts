// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { CSSProperties, ReactNode } from 'react';

// Rail geometry, mirrored from `$scrollable-height` and `$rail-dot-size` in
// `BufferSummaryPlot.scss`. The cap below is arithmetic on those numbers and has
// to be known before anything is laid out, so it can't be read back off the
// element; the stylesheet stays the source of truth for what is drawn, which
// means these two move with it.
const RAIL_HEIGHT = 600;
const RAIL_DOT_SIZE = 20;

/**
 * Upper bound on the dots one rail draws: as many as fit down the rail without
 * covering each other.
 *
 * Past this the dots overlap, and the ones underneath can't be clicked at all —
 * worse than being merged into a neighbour, which at least keeps their tensors
 * in a tooltip. Rails whose findings are bounded only by the report (late
 * deallocation) coalesce down to this. Top-N is capped by `TOP_N_COUNT_MAX`
 * (50), which is higher than this floor, so dense top-N selections can still
 * stack overlapping dots — coalesce is not applied there today.
 */
export const RAIL_MAX_DOTS = Math.floor(RAIL_HEIGHT / RAIL_DOT_SIZE);

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
