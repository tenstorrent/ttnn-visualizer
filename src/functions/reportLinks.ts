// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ReportFolder, ReportLocation } from '../definitions/Reports';
import { RemoteFolder } from '../definitions/RemoteConnection';

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
 * Canonical identity for a report in link records and badge lookups.
 * Remote `path` is always the full `remotePath`; local `path` is the local folder key.
 * `host` is null for local reports.
 */
export interface ReportIdentity {
    path: string;
    location: ReportLocation;
    host: string | null;
}

/**
 * A memory (profiler) report and a performance report that were compared while both
 * were active. Many-to-many by design — one report can link with several counterparts.
 */
export interface ReportLink {
    profilerPath: string;
    profilerLocation: ReportLocation;
    profilerHost: string | null;
    performancePath: string;
    performanceLocation: ReportLocation;
    performanceHost: string | null;
    status: ReportPairLinkStatus;
    /** Epoch ms; used for LRU capping. */
    recordedAt: number;
}

/** Soft cap on persisted pairs — oldest entries drop first when exceeded. */
export const MAX_REPORT_LINKS = 200;

export const REPORT_LINKS_STORAGE_KEY = 'reportLinks';

const normalisedHost = (host: string | null | undefined): string | null => host ?? null;

export const hostsMatch = (stored: string | null | undefined, expected: string | null | undefined): boolean =>
    normalisedHost(stored) === normalisedHost(expected);

/** Build a canonical identity; remote sides always carry a host (null if unknown). */
export const getReportIdentity = (folder: ReportFolder, location: ReportLocation): ReportIdentity => ({
    path: folder.path,
    location,
    host: location === ReportLocation.REMOTE ? (folder.host ?? null) : null,
});

/**
 * Resolve a backend active_report name (often a basename) to the canonical full
 * remotePath from the saved remote folder list.
 */
export const resolveRemoteReportIdentity = (
    folders: RemoteFolder[],
    nameOrPath: string | null,
    host: string | null,
): ReportIdentity | null => {
    if (!nameOrPath) {
        return null;
    }

    const exact = folders.find((folder) => folder.remotePath === nameOrPath);
    if (exact) {
        return { path: exact.remotePath, location: ReportLocation.REMOTE, host };
    }

    const bySuffix = folders.find(
        (folder) => folder.remotePath.endsWith(`/${nameOrPath}`) || folder.reportName === nameOrPath,
    );
    if (bySuffix) {
        return { path: bySuffix.remotePath, location: ReportLocation.REMOTE, host };
    }

    // Folders not synced yet — keep the name so a later selection can rewrite it.
    return { path: nameOrPath, location: ReportLocation.REMOTE, host };
};

const pairsMatch = (a: ReportLink, b: ReportLink): boolean =>
    a.profilerPath === b.profilerPath &&
    a.profilerLocation === b.profilerLocation &&
    hostsMatch(a.profilerHost, b.profilerHost) &&
    a.performancePath === b.performancePath &&
    a.performanceLocation === b.performanceLocation &&
    hostsMatch(a.performanceHost, b.performanceHost);

export const capReportLinks = (links: ReportLink[]): ReportLink[] =>
    links.length <= MAX_REPORT_LINKS ? links : links.slice(links.length - MAX_REPORT_LINKS);

/**
 * Insert or update a pair (identity ignores status). Moves the pair to the end so
 * recency-based capping keeps actively compared pairs. Returns the same reference
 * when the pair already exists with the same status (avoids jotai update loops).
 */
export const upsertReportLink = (links: ReportLink[], next: ReportLink): ReportLink[] => {
    const existing = links.find((link) => pairsMatch(link, next));

    if (existing && existing.status === next.status) {
        return links;
    }

    const without = links.filter((link) => !pairsMatch(link, next));
    return capReportLinks([...without, next]);
};

/** Drop every pair that references the given report identity on either side. */
export const pruneReportLinksForReport = (
    links: ReportLink[],
    path: string,
    location: ReportLocation,
    host: string | null = null,
): ReportLink[] => {
    const next = links.filter(
        (link) =>
            !(
                link.profilerPath === path &&
                link.profilerLocation === location &&
                hostsMatch(link.profilerHost, host)
            ) &&
            !(
                link.performancePath === path &&
                link.performanceLocation === location &&
                hostsMatch(link.performanceHost, host)
            ),
    );

    return next.length === links.length ? links : next;
};

const normaliseStoredLink = (raw: Partial<ReportLink> & { status?: string }): ReportLink | null => {
    if (!raw.profilerPath || !raw.performancePath || !raw.profilerLocation || !raw.performanceLocation) {
        return null;
    }

    return {
        profilerPath: raw.profilerPath,
        profilerLocation: raw.profilerLocation,
        profilerHost: raw.profilerHost ?? null,
        performancePath: raw.performancePath,
        performanceLocation: raw.performanceLocation,
        performanceHost: raw.performanceHost ?? null,
        status:
            raw.status === ReportPairLinkStatus.UNLINKED ? ReportPairLinkStatus.UNLINKED : ReportPairLinkStatus.LINKED,
        recordedAt: typeof raw.recordedAt === 'number' ? raw.recordedAt : 0,
    };
};

/** Read and normalise the persisted `reportLinks` list from storage. */
export const readReportLinksFromStorage = (storage: Storage = localStorage): ReportLink[] => {
    try {
        const raw = storage.getItem(REPORT_LINKS_STORAGE_KEY);
        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }

        return capReportLinks(
            (parsed as Partial<ReportLink>[])
                .map((entry) => normaliseStoredLink(entry))
                .filter((link): link is ReportLink => link !== null),
        );
    } catch {
        return [];
    }
};

const pathsForActiveProfiler = (
    links: ReportLink[],
    status: ReportPairLinkStatus,
    profilerPath: string | null | undefined,
    profilerLocation: ReportLocation | null | undefined,
    profilerHost: string | null | undefined = null,
    performanceHost: string | null | undefined = null,
): Set<string> => {
    if (!profilerPath || !profilerLocation) {
        return new Set();
    }

    return new Set(
        links
            .filter(
                (link) =>
                    link.status === status &&
                    link.profilerPath === profilerPath &&
                    link.profilerLocation === profilerLocation &&
                    hostsMatch(link.profilerHost, profilerHost) &&
                    hostsMatch(link.performanceHost, performanceHost),
            )
            .map((link) => link.performancePath),
    );
};

const pathsForActivePerformance = (
    links: ReportLink[],
    status: ReportPairLinkStatus,
    performancePath: string | null | undefined,
    performanceLocation: ReportLocation | null | undefined,
    performanceHost: string | null | undefined = null,
    profilerHost: string | null | undefined = null,
): Set<string> => {
    if (!performancePath || !performanceLocation) {
        return new Set();
    }

    return new Set(
        links
            .filter(
                (link) =>
                    link.status === status &&
                    link.performancePath === performancePath &&
                    link.performanceLocation === performanceLocation &&
                    hostsMatch(link.performanceHost, performanceHost) &&
                    hostsMatch(link.profilerHost, profilerHost),
            )
            .map((link) => link.profilerPath),
    );
};

export const linkedPerformancePaths = (
    links: ReportLink[],
    profilerPath: string | null | undefined,
    profilerLocation: ReportLocation | null | undefined,
    profilerHost: string | null | undefined = null,
    performanceHost: string | null | undefined = null,
): Set<string> =>
    pathsForActiveProfiler(
        links,
        ReportPairLinkStatus.LINKED,
        profilerPath,
        profilerLocation,
        profilerHost,
        performanceHost,
    );

export const linkedProfilerPaths = (
    links: ReportLink[],
    performancePath: string | null | undefined,
    performanceLocation: ReportLocation | null | undefined,
    performanceHost: string | null | undefined = null,
    profilerHost: string | null | undefined = null,
): Set<string> =>
    pathsForActivePerformance(
        links,
        ReportPairLinkStatus.LINKED,
        performancePath,
        performanceLocation,
        performanceHost,
        profilerHost,
    );

export const unlinkedPerformancePaths = (
    links: ReportLink[],
    profilerPath: string | null | undefined,
    profilerLocation: ReportLocation | null | undefined,
    profilerHost: string | null | undefined = null,
    performanceHost: string | null | undefined = null,
): Set<string> =>
    pathsForActiveProfiler(
        links,
        ReportPairLinkStatus.UNLINKED,
        profilerPath,
        profilerLocation,
        profilerHost,
        performanceHost,
    );

export const unlinkedProfilerPaths = (
    links: ReportLink[],
    performancePath: string | null | undefined,
    performanceLocation: ReportLocation | null | undefined,
    performanceHost: string | null | undefined = null,
    profilerHost: string | null | undefined = null,
): Set<string> =>
    pathsForActivePerformance(
        links,
        ReportPairLinkStatus.UNLINKED,
        performancePath,
        performanceLocation,
        performanceHost,
        profilerHost,
    );
