// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Availability ("is a perf report loaded at all") and linkage ("do its ops
// overlap this graph") are separate so the tooltip can tell the user which of
// the two is missing.
export enum PerfOverlayStatus {
    UNAVAILABLE,
    UNLINKED,
    READY,
}

export const PERF_OVERLAY_TOOLTIP: Record<PerfOverlayStatus, string> = {
    [PerfOverlayStatus.UNAVAILABLE]: 'Load a performance report to enable perf overlay.',
    [PerfOverlayStatus.UNLINKED]: "Loaded performance report doesn't match this graph (no operations in common).",
    [PerfOverlayStatus.READY]: 'Size and colour a bar on each node by per-op kernel duration.',
};

// Same statuses gate the critical path: both read per-op durations, so a report
// that can't feed the bars can't weigh the path either. #1613
export const CRITICAL_PATH_TOOLTIP: Record<PerfOverlayStatus, string> = {
    [PerfOverlayStatus.UNAVAILABLE]: 'Load a performance report to enable critical-path highlighting.',
    [PerfOverlayStatus.UNLINKED]: "Loaded performance report doesn't match this graph (no operations in common).",
    [PerfOverlayStatus.READY]: 'Trace the longest cumulative-duration path through the graph.',
};
