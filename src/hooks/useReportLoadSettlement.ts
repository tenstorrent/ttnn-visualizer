// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, HttpStatusCode } from 'axios';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';
import { ReportKind, ReportLoadFailureReason, ReportSource } from '../definitions/EventLogEvent';
import { DBVersionValidation } from '../definitions/Versions';
import { evaluateDbVersion } from '../functions/compareDbVersion';
import { recordReportLoadFailed, recordReportLoadFailure, recordReportLoaded } from '../functions/reportLoadEvents';
import {
    PendingReportLoad,
    SettledReportKind,
    activePerformanceReportAtom,
    activePerformanceReportFolderNameAtom,
    activeProfilerReportAtom,
    filterBySignpostAtom,
    pendingReportLoadsAtom,
} from '../store/app';
import { usePerformanceReport, useReportMetadata } from './useAPI';

/** Marks a chosen report as pending, so its load event is recorded once its data settles. */
export const useMarkReportLoadPending = () => {
    const setPendingReportLoads = useSetAtom(pendingReportLoadsAtom);

    return useCallback(
        (kind: SettledReportKind, path: string, source: ReportSource) =>
            setPendingReportLoads((pending) => ({ ...pending, [kind]: { path, source } })),
        [setPendingReportLoads],
    );
};

const getErrorStatus = (error: AxiosError) => error.status ?? error.response?.status;

/**
 * Records `report_loaded` or `report_load_failed` for a report chosen inside the visualizer
 * once its data settles: the memory report's metadata, or the performance report's rows.
 *
 * Only a report with a pending marker for its own path is recorded, so a restored report,
 * or a choice replaced before its data arrived, records nothing. Every decision reads the
 * values of the render that produced it: `Range` unloads a performance report that fails
 * in the same commit, and the failure must still be recorded against it.
 */
const useReportLoadSettlement = () => {
    const pendingReportLoads = useAtomValue(pendingReportLoadsAtom);
    const setPendingReportLoads = useSetAtom(pendingReportLoadsAtom);
    const activeProfilerPath = useAtomValue(activeProfilerReportAtom)?.path ?? null;
    const activePerformancePath = useAtomValue(activePerformanceReportAtom)?.path ?? null;
    const activePerformanceFolderName = useAtomValue(activePerformanceReportFolderNameAtom);
    const hasSignpostRange = useAtomValue(filterBySignpostAtom).some((signpost) => signpost !== null);
    const { data: reportMetadata, error: reportMetadataError } = useReportMetadata();
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

        if (reportMetadataError) {
            // Legacy reports lack the metadata table and still open
            if (getErrorStatus(reportMetadataError) === HttpStatusCode.UnprocessableEntity) {
                recordReportLoaded(ReportKind.PROFILER, pendingProfiler.source);
            } else {
                recordReportLoadFailure(ReportKind.PROFILER, reportMetadataError);
            }
        } else if (reportMetadata) {
            if (evaluateDbVersion(reportMetadata.version).statusCode === DBVersionValidation.OK) {
                recordReportLoaded(ReportKind.PROFILER, pendingProfiler.source);
            } else {
                // The report still opens, with a warning, but cannot be read reliably
                recordReportLoadFailed(ReportKind.PROFILER, ReportLoadFailureReason.UNSUPPORTED_VERSION);
            }
        } else {
            return;
        }

        clearPending(ReportKind.PROFILER, pendingProfiler);
    }, [pendingProfiler, activeProfilerPath, reportMetadata, reportMetadataError, clearPending]);

    useEffect(() => {
        if (!pendingPerformance) {
            return;
        }

        if (pendingPerformance.path !== activePerformancePath) {
            clearPending(ReportKind.PERFORMANCE, pendingPerformance);
            return;
        }

        if (performanceReportError) {
            const status = getErrorStatus(performanceReportError);

            // `Range` drops a refused signpost range and keeps the report; the refetch settles it
            if (status === HttpStatusCode.BadRequest && hasSignpostRange) {
                return;
            }

            if (status === HttpStatusCode.UnprocessableEntity) {
                recordReportLoadFailed(ReportKind.PERFORMANCE, ReportLoadFailureReason.PARSE_ERROR);
            } else {
                recordReportLoadFailure(ReportKind.PERFORMANCE, performanceReportError);
            }
        } else if (performanceReport) {
            recordReportLoaded(ReportKind.PERFORMANCE, pendingPerformance.source);
        } else {
            return;
        }

        clearPending(ReportKind.PERFORMANCE, pendingPerformance);
    }, [
        pendingPerformance,
        activePerformancePath,
        performanceReport,
        performanceReportError,
        hasSignpostRange,
        clearPending,
    ]);
};

export default useReportLoadSettlement;
