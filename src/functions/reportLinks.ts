// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    LinkedReportIdOptions,
    MAX_REPORT_LINKS,
    ReportLink,
    ReportLinkAccess,
    ReportPairLinkStatus,
} from '../definitions/ReportLinks';
import { ReportLocation } from '../definitions/Reports';

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

const matchesHostScope = (access: ReportLinkAccess | undefined, remoteHost?: string | null): boolean => {
    if (!remoteHost) {
        return true;
    }

    if (!access || access.location === ReportLocation.LOCAL || !access.host) {
        return true;
    }

    return access.host === remoteHost;
};

const idsForActiveProfiler = (
    links: ReportLink[],
    status: ReportPairLinkStatus,
    profilerId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> => {
    if (!profilerId) {
        return new Set();
    }

    return new Set(
        links
            .filter((link) => link.status === status && link.profilerId === profilerId)
            .filter((link) => matchesHostScope(link.performanceAccess, options?.remoteHost))
            .map((link) => link.performanceId),
    );
};

const idsForActivePerformance = (
    links: ReportLink[],
    status: ReportPairLinkStatus,
    performanceId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> => {
    if (!performanceId) {
        return new Set();
    }

    return new Set(
        links
            .filter((link) => link.status === status && link.performanceId === performanceId)
            .filter((link) => matchesHostScope(link.profilerAccess, options?.remoteHost))
            .map((link) => link.profilerId),
    );
};

export const linkedPerformanceIds = (
    links: ReportLink[],
    profilerId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> => idsForActiveProfiler(links, ReportPairLinkStatus.LINKED, profilerId, options);

export const unlinkedPerformanceIds = (
    links: ReportLink[],
    profilerId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> => idsForActiveProfiler(links, ReportPairLinkStatus.UNLINKED, profilerId, options);

export const linkedProfilerIds = (
    links: ReportLink[],
    performanceId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> => idsForActivePerformance(links, ReportPairLinkStatus.LINKED, performanceId, options);

export const unlinkedProfilerIds = (
    links: ReportLink[],
    performanceId: string | null | undefined,
    options?: LinkedReportIdOptions,
): Set<string> => idsForActivePerformance(links, ReportPairLinkStatus.UNLINKED, performanceId, options);
