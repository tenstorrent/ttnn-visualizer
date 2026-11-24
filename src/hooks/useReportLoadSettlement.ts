// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { HttpStatusCode } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useCallback, useEffect } from 'react';
import { ReportKind, ReportLoadFailureReason, ReportSource } from '../definitions/EventLogEvent';
import { DBVersionValidation } from '../definitions/Versions';
import { evaluateDbVersion } from '../functions/compareDbVersion';
import getErrorStatus, { isRefusedSignpostRange } from '../functions/getErrorStatus';
import {
    getParsedReportLoadFailureReason,
    recordReportLoadFailed,
    recordReportLoadFailure,
    recordReportLoaded,
} from '../functions/reportLoadEvents';
import {
    PendingReportLoad,
    SettledReportKind,
    activePerformanceReportAtom,
    activePerformanceReportFolderNameAtom,
    activeProfilerReportAtom,
    filterBySignpostAtom,
    pendingReportLoadsAtom,
} from '../store/app';
import { resetMemoryReportReads, useOperationsList, usePerformanceReport, useReportMetadata } from './useAPI';

/**
 * Marks a chosen report as pending, so its load event is recorded once its data settles.
 *
 * A memory report's cached reads are reset first, so the outcome comes from this choice's own
 * request. Call it once the server has the report active, so that request is answered for it.
 * The performance report needs no reset: its query is keyed by location too, and the footer
 * unloads one that fails, so choosing it again changes the key and refetches.
 */
export const useMarkReportLoadPending = () => {
    const queryClient = useQueryClient();
    const setPendingReportLoads = useSetAtom(pendingReportLoadsAtom);

    return useCallback(
        (kind: SettledReportKind, path: string, source: ReportSource) => {
            if (kind === ReportKind.PROFILER) {
                // Not awaited: the reset is synchronous, and the refetch it starts settles the marker
                void resetMemoryReportReads(queryClient, path);
            }

            setPendingReportLoads((pending) => ({ ...pending, [kind]: { path, source } }));
        },
        [queryClient, setPendingReportLoads],
    );
};

/**
 * Records `report_loaded` or `report_load_failed` for a report chosen inside the visualizer
 * once its data settles: the memory report's operations and metadata, or the performance
 * report's rows.
 *
 * Only a report with a pending marker for its own path is recorded, so a restored report,
 * or a choice replaced before its data arrived, records nothing. Every decision reads the
 * values of the render that produced it: `Range` unloads a performance report that fails
 * in the same commit, and the failure must still be recorded against it.
 */
const useReportLoadSettlement = () => {
    const store = useStore();
    const pendingReportLoads = useAtomValue(pendingReportLoadsAtom);
    const setPendingReportLoads = useSetAtom(pendingReportLoadsAtom);
    const activeProfilerPath = useAtomValue(activeProfilerReportAtom)?.path ?? null;
    const activePerformancePath = useAtomValue(activePerformanceReportAtom)?.path ?? null;
    const activePerformanceFolderName = useAtomValue(activePerformanceReportFolderNameAtom);
    const hasSignpostRange = useAtomValue(filterBySignpostAtom).some((signpost) => signpost !== null);
    const { data: reportMetadata, error: reportMetadataError } = useReportMetadata();
    const { data: operations, error: operationsError } = useOperationsList();
    const { data: performanceReport, error: performanceReportError } =
        usePerformanceReport(activePerformanceFolderName);

    const pendingProfiler = pendingReportLoads[ReportKind.PROFILER];
    const pendingPerformance = pendingReportLoads[ReportKind.PERFORMANCE];

    const clearPending = useCallback(
        (kind: SettledReportKind, marker: PendingReportLoad) =>
            setPendingReportLoads((pending) => {
                // A newer choice may have replaced this marker since the render that settled it
                if (pending[kind] !== marker) {
                    return pending;
                }

                const next = { ...pending };
                delete next[kind];

                return next;
            }),
        [setPendingReportLoads],
    );

    /**
     * Records a marker's outcome once. The live store is checked rather than the render's
     * value: an effect re-run before that render catches up, as a remount under StrictMode
     * does, would otherwise record the same outcome again.
     */
    const settle = useCallback(
        (kind: SettledReportKind, marker: PendingReportLoad, record: () => void) => {
            if (store.get(pendingReportLoadsAtom)[kind] !== marker) {
                return;
            }

            record();
            clearPending(kind, marker);
        },
        [store, clearPending],
    );

    useEffect(() => {
        if (!pendingProfiler) {
            return;
        }

        // Cleared or replaced before its data settled. Choosing a report writes its marker in
        // the same batch as the active report, so a mismatch is never a choice still landing.
        if (pendingProfiler.path !== activeProfilerPath) {
            clearPending(ReportKind.PROFILER, pendingProfiler);
            return;
        }

        // The version decides first: a report the server cannot query is the likeliest to be
        // unsupported, and its operations can fail before its metadata arrives
        if (reportMetadata === undefined && reportMetadataError === null) {
            return;
        }

        // Legacy reports lack the metadata table, and still open
        const isLegacyMetadata = getErrorStatus(reportMetadataError) === HttpStatusCode.UnprocessableEntity;
        const isSupportedVersion =
            reportMetadata !== undefined &&
            evaluateDbVersion(reportMetadata.version).statusCode === DBVersionValidation.OK;

        let record: () => void;

        if (reportMetadata && !isSupportedVersion) {
            // The report still opens, with a warning, but cannot be read reliably
            record = () => recordReportLoadFailed(ReportKind.PROFILER, ReportLoadFailureReason.UNSUPPORTED_VERSION);
        } else if (operationsError) {
            record = () => recordReportLoadFailure(ReportKind.PROFILER, operationsError);
        } else if (reportMetadataError && !isLegacyMetadata) {
            record = () => recordReportLoadFailure(ReportKind.PROFILER, reportMetadataError);
        } else if (operations) {
            record = () => recordReportLoaded(ReportKind.PROFILER, pendingProfiler.source);
        } else {
            return;
        }

        settle(ReportKind.PROFILER, pendingProfiler, record);
    }, [
        pendingProfiler,
        activeProfilerPath,
        reportMetadata,
        reportMetadataError,
        operations,
        operationsError,
        clearPending,
        settle,
    ]);

    useEffect(() => {
        if (!pendingPerformance) {
            return;
        }

        if (pendingPerformance.path !== activePerformancePath) {
            clearPending(ReportKind.PERFORMANCE, pendingPerformance);
            return;
        }

        let record: () => void;

        if (performanceReportError) {
            // `Range` drops a refused signpost range and keeps the report; the refetch settles it
            if (isRefusedSignpostRange(performanceReportError, hasSignpostRange)) {
                return;
            }

            record = () =>
                recordReportLoadFailure(
                    ReportKind.PERFORMANCE,
                    performanceReportError,
                    getParsedReportLoadFailureReason,
                );
        } else if (performanceReport) {
            record = () => recordReportLoaded(ReportKind.PERFORMANCE, pendingPerformance.source);
        } else {
            return;
        }

        settle(ReportKind.PERFORMANCE, pendingPerformance, record);
    }, [
        pendingPerformance,
        activePerformancePath,
        performanceReport,
        performanceReportError,
        hasSignpostRange,
        clearPending,
        settle,
    ]);
};

export default useReportLoadSettlement;
