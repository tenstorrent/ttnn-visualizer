// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    LinkedReportIdOptions,
    MAX_REPORT_LINKS,
    ReportLinkRole,
    ReportPairLinkStatus,
} from '../definitions/ReportLinks';
import { ReportLocation } from '../definitions/Reports';
import { ReportLink, ReportLinkAccess } from '../model/ReportLinks';

/**
 * Stable report identity: final path segment (folder basename).
 * Prefer the filesystem/remote folder name over display reportName.
 */
export const getReportId = (...candidates: Array<string | null | undefined>): string | null => {
    for (const candidate of candidates) {
        if (candidate) {
            const id = pathBasename(candidate);
            if (id && id !== '.' && id !== '..') {
                return id;
            }
        }
    }

    return null;
};

const pathBasename = (value: string): string => {
    const normalised = value.replace(/\\/g, '/');
    const segments = normalised.split('/').filter(Boolean);
    // Empty after stripping separators (e.g. '/', '\\') — not a usable report id.
    return segments.length > 0 ? segments[segments.length - 1]! : '';
};

const isSamePair = (a: ReportLink, b: ReportLink): boolean =>
    a.profilerId === b.profilerId && a.performanceId === b.performanceId;

export const capReportLinks = (links: ReportLink[]): ReportLink[] =>
    links.length <= MAX_REPORT_LINKS ? links : links.slice(links.length - MAX_REPORT_LINKS);

/**
 * Insert or update a pair (identity ignores status). On insert or status change,
 * appends the pair at the end so recency-based capping keeps actively compared
 * pairs. Returns the same array reference when the pair already exists with the
 * same status (avoids jotai update loops) — that path does not bump recency or
 * recordedAt.
 */
export const upsertReportLink = (links: ReportLink[], next: ReportLink): ReportLink[] => {
    const existing = links.find((link) => isSamePair(link, next));

    if (existing && existing.status === next.status) {
        return links;
    }

    const without = links.filter((link) => !isSamePair(link, next));
    return capReportLinks([...without, next]);
};

const getRoleId = (link: ReportLink, role: ReportLinkRole): string =>
    role === ReportLinkRole.PROFILER ? link.profilerId : link.performanceId;

const getRoleAccess = (link: ReportLink, role: ReportLinkRole): ReportLinkAccess | undefined =>
    role === ReportLinkRole.PROFILER ? link.profilerAccess : link.performanceAccess;

const getOppositeRole = (role: ReportLinkRole): ReportLinkRole =>
    role === ReportLinkRole.PROFILER ? ReportLinkRole.PERFORMANCE : ReportLinkRole.PROFILER;

/**
 * How a report was reached when its pair was recorded. `host` is kept only for a remote
 * side: host scoping treats a missing host as "matches anywhere", so a local report must
 * not inherit whichever remote connection happens to be selected.
 */
export const createReportLinkAccess = (
    location: ReportLocation,
    path: string,
    remoteHost: string | null,
): ReportLinkAccess => ({
    location,
    path,
    host: location === ReportLocation.REMOTE ? remoteHost : null,
});

/**
 * Drop every pair whose `role` side is `reportId`, e.g. after that report is deleted.
 * Ids are folder basenames, so this also drops pairs recorded against a remote copy of
 * the same run; those reappear the next time the pair is compared. Returns the same
 * array reference when nothing matches, so callers don't write storage for a no-op.
 */
export const removeReportLinksFor = (
    links: ReportLink[],
    role: ReportLinkRole,
    reportId: string | null,
): ReportLink[] => {
    if (!reportId || !links.some((link) => getRoleId(link, role) === reportId)) {
        return links;
    }

    return links.filter((link) => getRoleId(link, role) !== reportId);
};

const matchesHostScope = (access: ReportLinkAccess | undefined, remoteHost?: string | null): boolean => {
    if (!remoteHost) {
        return true;
    }

    if (!access || access.location === ReportLocation.LOCAL || !access.host) {
        return true;
    }

    return access.host === remoteHost;
};

/**
 * Ids on the opposite side of every `status` pair whose `activeRole` side is `activeId`.
 * Host scoping checks the counterpart's access, since that is the report being badged.
 */
const counterpartIds = (
    links: ReportLink[],
    status: ReportPairLinkStatus,
    activeRole: ReportLinkRole,
    activeId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> => {
    if (!activeId) {
        return new Set();
    }

    const counterpartRole = getOppositeRole(activeRole);

    return new Set(
        links
            .filter((link) => link.status === status && getRoleId(link, activeRole) === activeId)
            .filter((link) => matchesHostScope(getRoleAccess(link, counterpartRole), options?.remoteHost))
            .map((link) => getRoleId(link, counterpartRole)),
    );
};

export const linkedPerformanceIds = (
    links: ReportLink[],
    profilerId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> => counterpartIds(links, ReportPairLinkStatus.LINKED, ReportLinkRole.PROFILER, profilerId, options);

export const unlinkedPerformanceIds = (
    links: ReportLink[],
    profilerId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> => counterpartIds(links, ReportPairLinkStatus.UNLINKED, ReportLinkRole.PROFILER, profilerId, options);

export const linkedProfilerIds = (
    links: ReportLink[],
    performanceId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> =>
    counterpartIds(links, ReportPairLinkStatus.LINKED, ReportLinkRole.PERFORMANCE, performanceId, options);

export const unlinkedProfilerIds = (
    links: ReportLink[],
    performanceId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> =>
    counterpartIds(links, ReportPairLinkStatus.UNLINKED, ReportLinkRole.PERFORMANCE, performanceId, options);
