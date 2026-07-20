// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ReportLocation } from './Reports';

/** Persisted outcome of a memory↔performance pair comparison. */
export enum ReportPairLinkStatus {
    LINKED = 'linked',
    UNLINKED = 'unlinked',
}

/** Live match result used before (or instead of) persisting a pair. */
export enum ReportLinkMatchResult {
    LINKED = 'linked',
    UNLINKED = 'unlinked',
    PENDING = 'pending',
    UNAVAILABLE = 'unavailable',
}

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

export interface LinkedReportIdOptions {
    /**
     * When set (remote picker), drop counterparts recorded only against a
     * different remote host. Local / unknown-host links still match for mix-and-match.
     */
    remoteHost?: string | null;
}

/** Soft cap on persisted pairs — oldest entries drop first when exceeded. */
export const MAX_REPORT_LINKS = 200;

export const REPORT_LINKS_STORAGE_KEY = 'reportLinks.v2';
