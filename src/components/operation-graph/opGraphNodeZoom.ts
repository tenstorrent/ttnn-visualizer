// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Sizes inside the scaled viewport are graph units, not screen pixels. The SCSS
// divides by the live zoom to hold an on-screen floor for a node's perf bar and rank
// badge, without which they wash out at exactly the zoom a whole report fits in. #1610
export const NODE_ZOOM_VAR = '--op-graph-node-zoom';

// d3-zoom emits a new scale nearly every frame, and the property above is
// inherited by every node's bar and badge, so an unquantised write invalidates style for
// the whole graph per frame. Buckets are proportional rather than a fixed step
// because the zoom range spans 0.02–3: absolute tenths collapse the entire
// overview range to 0, which would divide by zero in the SCSS and drop the
// declaration. A 1.1 ratio holds the bar floor within ~5% of true. #1610
const NODE_ZOOM_BUCKET_RATIO = 1.1;

/**
 * Zoom rounded to the nearest proportional bucket. Falls back to `1` — the
 * SCSS's own fallback — for non-positive or non-finite input, so a degenerate
 * transform can never write a value that invalidates the bar or badge geometry.
 */
export const getQuantisedNodeZoom = (zoom: number): number => {
    if (!Number.isFinite(zoom) || zoom <= 0) {
        return 1;
    }
    const bucket = Math.round(Math.log(zoom) / Math.log(NODE_ZOOM_BUCKET_RATIO));
    return NODE_ZOOM_BUCKET_RATIO ** bucket;
};
