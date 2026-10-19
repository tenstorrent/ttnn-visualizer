// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

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

/** Which side of a memory↔performance pair a report id sits on. */
export enum ReportLinkRole {
    PROFILER = 'profiler',
    PERFORMANCE = 'performance',
}

export interface LinkedReportIdOptions {
    /**
     * When set (remote picker), drop counterparts recorded only against a
     * different remote host. Local / unknown-host links still match for mix-and-match.
     */
    remoteHost?: string | null;
    /**
     * Run fingerprint of the report whose counterparts are looked up. Links recorded
     * against another run in the same folder are dropped; null or omitted keeps them all.
     */
    activeRun?: string | null;
}

/**
 * Counterpart report id → the run each of its links recorded for it, `undefined` where
 * a link predates run fingerprints (#2069) or the run was unknown. A picker row counts
 * a link only when one of these runs is the run its folder holds now.
 */
export type ReportLinkRunsById = ReadonlyMap<string, ReadonlyArray<string | undefined>>;

// Footer link-status tooltip copy; specs assert on what the user reads.
export const REPORTS_LINKED_TOOLTIP = 'Data linked between memory and performance reports';
export const REPORTS_UNLINKED_TOOLTIP = 'Unable to link active memory and performance reports';
export const REPORTS_UNLINKED_TOOLTIP_HINT =
    'Please select reports generated from the same run to see additional data across the visualizer';

/** Soft cap on persisted pairs; the least recently compared drop first when exceeded. */
export const MAX_REPORT_LINKS = 200;

export const REPORT_LINKS_STORAGE_KEY = 'reportLinks.v2';
