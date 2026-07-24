// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import {
    useDevices,
    useGetDeviceOperationListPerf,
    useOperationsList,
    usePerformanceManifest,
    usePerformanceReport,
    useReportMetadata,
} from './useAPI';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../store/app';
import { ReportLinkMatchResult } from '../definitions/ReportLinks';

/**
 * Extract a settled run_id from a query. Missing legacy metadata (422), absent
 * values, and other query errors count as settled with null so linking can fall
 * back to op-name matching rather than blocking the UI.
 */
const getSettledRunId = (query: {
    isFetched: boolean;
    isFetching: boolean;
    isError: boolean;
    data: { runId: string | null } | undefined;
}): { settled: boolean; runId: string | null } => {
    if (!query.isFetched || query.isFetching) {
        return { settled: false, runId: null };
    }

    if (query.isError) {
        return { settled: true, runId: null };
    }

    return { settled: true, runId: query.data?.runId ?? null };
};

/**
 * Live memory↔performance match outcome. Prefers shared ``run_id`` when both
 * reports expose one; otherwise falls back to device-op / ``raw_op_code``
 * lock-step matching. PENDING while underlying queries are in flight;
 * LINKED/UNLINKED once settled; UNAVAILABLE if a required fallback query errored.
 */
export const useReportLinkMatch = (): ReportLinkMatchResult => {
    const matchedOperations = useGetDeviceOperationListPerf();
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    const reportMetadataQuery = useReportMetadata();
    const performanceManifestQuery = usePerformanceManifest();

    const {
        isFetched: isOperationsFetched,
        isFetching: isOperationsFetching,
        isError: isOperationsError,
    } = useOperationsList();
    const { isFetched: isDevicesFetched, isFetching: isDevicesFetching, isError: isDevicesError } = useDevices();
    const {
        isFetched: isPerformanceFetched,
        isFetching: isPerformanceFetching,
        isError: isPerformanceError,
    } = usePerformanceReport(activePerformanceReport?.reportName || null);

    if (!activeProfilerReport || !activePerformanceReport) {
        return ReportLinkMatchResult.UNAVAILABLE;
    }

    const memoryRunId = getSettledRunId({
        isFetched: reportMetadataQuery.isFetched,
        isFetching: reportMetadataQuery.isFetching,
        isError: reportMetadataQuery.isError,
        data: reportMetadataQuery.data,
    });
    const performanceRunId = getSettledRunId({
        isFetched: performanceManifestQuery.isFetched,
        isFetching: performanceManifestQuery.isFetching,
        isError: performanceManifestQuery.isError,
        data: performanceManifestQuery.data,
    });

    if (!memoryRunId.settled || !performanceRunId.settled) {
        return ReportLinkMatchResult.PENDING;
    }

    if (memoryRunId.runId !== null && performanceRunId.runId !== null) {
        return memoryRunId.runId === performanceRunId.runId
            ? ReportLinkMatchResult.LINKED
            : ReportLinkMatchResult.UNLINKED;
    }

    // Fall back to device-op name ↔ raw_op_code lock-step matching.
    if (matchedOperations.length > 0) {
        return ReportLinkMatchResult.LINKED;
    }

    const comparisonSettled =
        isOperationsFetched &&
        !isOperationsFetching &&
        isDevicesFetched &&
        !isDevicesFetching &&
        isPerformanceFetched &&
        !isPerformanceFetching;

    if (!comparisonSettled) {
        return ReportLinkMatchResult.PENDING;
    }

    if (isOperationsError || isDevicesError || isPerformanceError) {
        return ReportLinkMatchResult.UNAVAILABLE;
    }

    return ReportLinkMatchResult.UNLINKED;
};
