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

// Read by the graph hover chip and the details panel row. One constant because
// they describe the same absence, and drift between them would read as two
// different states.
export const NO_PERF_DATA_LABEL = 'No perf data';

export const PERF_OVERLAY_TOOLTIP: Record<PerfOverlayStatus, string> = {
    [PerfOverlayStatus.UNAVAILABLE]: 'Load a performance report to enable perf overlay.',
    [PerfOverlayStatus.UNLINKED]: "Loaded performance report doesn't match this graph (no operations in common).",
    [PerfOverlayStatus.READY]: 'Size and colour a bar on each node by per-op kernel duration.',
};
