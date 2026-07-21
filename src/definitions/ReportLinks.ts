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
