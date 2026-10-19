// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    LinkedReportIdOptions,
    MAX_REPORT_LINKS,
    ReportLinkMatchResult,
    ReportLinkRole,
    ReportLinkRunsById,
    ReportPairLinkStatus,
} from '../definitions/ReportLinks';
import { ReportFolder, ReportLocation } from '../definitions/Reports';
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

/**
 * Id of a local report folder. Recording, pruning and badging must all key a folder
 * the same way, so a synced folder resolves to its `syncedName` before its `path`.
 */
export const getFolderReportId = (folder: Pick<ReportFolder, 'syncedName' | 'path'> | null | undefined) =>
    getReportId(folder?.syncedName, folder?.path);

const pathBasename = (value: string): string => {
    const normalised = value.replace(/\\/g, '/');
    const segments = normalised.split('/').filter(Boolean);
    // Empty after stripping separators (e.g. '/', '\\') — not a usable report id.
    return segments.length > 0 ? segments[segments.length - 1]! : '';
};

/**
 * Whether a live comparison has reached a verdict. Only a settled match is recorded or
 * announced; PENDING and UNAVAILABLE say nothing about whether the reports belong together.
 */
export const isSettledLinkMatch = (result: ReportLinkMatchResult): boolean =>
    result === ReportLinkMatchResult.LINKED || result === ReportLinkMatchResult.UNLINKED;

const isSamePair = (a: ReportLink, b: ReportLink): boolean =>
    a.profilerId === b.profilerId && a.performanceId === b.performanceId;

// `host` is optional on stored access, so a missing host and `null` are the same.
const isSameAccess = (a: ReportLinkAccess | undefined, b: ReportLinkAccess | undefined): boolean =>
    a?.location === b?.location && a?.path === b?.path && (a?.host ?? null) === (b?.host ?? null);

/**
 * Whether a link's recorded run still describes a folder. A side with no recorded or
 * no current fingerprint cannot be told apart, so it matches, as before #2069.
 */
export const isSameRun = (storedRun: string | undefined, currentRun: string | null | undefined): boolean =>
    !storedRun || !currentRun || storedRun === currentRun;

export const capReportLinks = (links: ReportLink[]): ReportLink[] =>
    links.length <= MAX_REPORT_LINKS ? links : links.slice(links.length - MAX_REPORT_LINKS);

/**
 * Insert or replace a pair (identity ignores status, access, runs and `recordedAt`),
 * moving it to the end so capping evicts the least recently compared pairs first. A new
 * run in either folder therefore replaces the old run's entry for the same pair. Returns
 * the same array reference only when the pair is already last with the same status,
 * access and runs, which spares `useReportLinkBadgeRuns` subscribers a re-render.
 */
export const upsertReportLink = (links: ReportLink[], next: ReportLink): ReportLink[] => {
    const last = links[links.length - 1];

    if (
        last &&
        isSamePair(last, next) &&
        last.status === next.status &&
        last.profilerRun === next.profilerRun &&
        last.performanceRun === next.performanceRun &&
        isSameAccess(last.profilerAccess, next.profilerAccess) &&
        isSameAccess(last.performanceAccess, next.performanceAccess)
    ) {
        return links;
    }

    const without = links.filter((link) => !isSamePair(link, next));
    return capReportLinks([...without, next]);
};

const getRoleId = (link: ReportLink, role: ReportLinkRole): string =>
    role === ReportLinkRole.PROFILER ? link.profilerId : link.performanceId;

const getRoleRun = (link: ReportLink, role: ReportLinkRole): string | undefined =>
    role === ReportLinkRole.PROFILER ? link.profilerRun : link.performanceRun;

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
 * array reference when nothing matches, which spares subscribers a re-render; the
 * storage atom still writes `localStorage` on every set.
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
 * Counterparts of every `status` pair whose `activeRole` side is `activeId` and was
 * recorded against the run that folder holds now, each with the runs recorded for it.
 * Host scoping checks the counterpart's access, since that is the report being badged.
 */
const counterpartRunsById = (
    links: ReportLink[],
    status: ReportPairLinkStatus,
    activeRole: ReportLinkRole,
    activeId: string | null | undefined,
    options?: LinkedReportIdOptions,
): ReportLinkRunsById => {
    const runsById = new Map<string, Array<string | undefined>>();

    if (!activeId) {
        return runsById;
    }

    const counterpartRole = getOppositeRole(activeRole);

    links
        .filter((link) => link.status === status && getRoleId(link, activeRole) === activeId)
        .filter((link) => isSameRun(getRoleRun(link, activeRole), options?.activeRun))
        .filter((link) => matchesHostScope(getRoleAccess(link, counterpartRole), options?.remoteHost))
        .forEach((link) => {
            const counterpartId = getRoleId(link, counterpartRole);
            const runs = runsById.get(counterpartId) ?? [];
            runs.push(getRoleRun(link, counterpartRole));
            runsById.set(counterpartId, runs);
        });

    return runsById;
};

export const linkedPerformanceRuns = (
    links: ReportLink[],
    profilerId: string | null | undefined,
    options?: LinkedReportIdOptions,
): ReportLinkRunsById =>
    counterpartRunsById(links, ReportPairLinkStatus.LINKED, ReportLinkRole.PROFILER, profilerId, options);

export const unlinkedPerformanceRuns = (
    links: ReportLink[],
    profilerId: string | null | undefined,
    options?: LinkedReportIdOptions,
): ReportLinkRunsById =>
    counterpartRunsById(links, ReportPairLinkStatus.UNLINKED, ReportLinkRole.PROFILER, profilerId, options);

export const linkedProfilerRuns = (
    links: ReportLink[],
    performanceId: string | null | undefined,
    options?: LinkedReportIdOptions,
): ReportLinkRunsById =>
    counterpartRunsById(links, ReportPairLinkStatus.LINKED, ReportLinkRole.PERFORMANCE, performanceId, options);

export const unlinkedProfilerRuns = (
    links: ReportLink[],
    performanceId: string | null | undefined,
    options?: LinkedReportIdOptions,
): ReportLinkRunsById =>
    counterpartRunsById(links, ReportPairLinkStatus.UNLINKED, ReportLinkRole.PERFORMANCE, performanceId, options);
