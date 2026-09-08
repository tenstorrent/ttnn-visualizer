// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ReportLocation } from '../definitions/Reports';
import { ReportPairLinkStatus } from '../definitions/ReportLinks';

/**
 * How a report was accessed when a link was observed. Provenance only — matching
 * uses {@link ReportLink.profilerId} / {@link ReportLink.performanceId}.
 */
export interface ReportLinkAccess {
    location: ReportLocation;
    /** Active report path at link time (local folder name or remote path). */
    path: string;
    /** Remote host when location is remote; omitted for local. */
    host?: string | null;
}

/**
 * A memory (profiler) report and a performance report that were compared while both
 * were active. Identity is the report folder basename so the same run badges whether
 * opened locally or via remote sync. Many-to-many by design.
 */
export interface ReportLink {
    profilerId: string;
    performanceId: string;
    status: ReportPairLinkStatus;
    profilerAccess?: ReportLinkAccess;
    performanceAccess?: ReportLinkAccess;
    /** Epoch ms; used for LRU capping. */
    recordedAt: number;
}
