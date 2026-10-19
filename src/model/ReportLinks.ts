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
    /**
     * Run fingerprint of each side when the pair was compared, so a later run written
     * into the same folder does not inherit the verdict (#2069). Absent on links stored
     * before fingerprints existed, or when the run was unknown; absent matches any run.
     */
    profilerRun?: string;
    performanceRun?: string;
    /**
     * Epoch ms when the pair was last stored or moved to the end. Kept as is when the pair
     * is seen again already last and unchanged. Informational; capping uses array order.
     */
    recordedAt: number;
}

/** Which run each active report's folder holds, from `GET /api/report-fingerprints`. */
export interface ActiveReportFingerprints {
    profiler: string | null;
    performance: string | null;
}
