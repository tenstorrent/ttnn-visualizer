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
    [PerfOverlayStatus.READY]: 'Colour nodes by per-op kernel duration.',
};
