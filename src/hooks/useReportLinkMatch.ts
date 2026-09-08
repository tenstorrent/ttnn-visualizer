// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useAtomValue } from 'jotai';
import { useDevices, useGetDeviceOperationListPerf, useLinkedPerformanceReport, useOperationsList } from './useAPI';
import { activePerformanceReportAtom, activeProfilerReportAtom } from '../store/app';
import { ReportLinkMatchResult } from '../definitions/ReportLinks';

/**
 * Live memory↔performance match outcome. PENDING while underlying queries are in
 * flight; LINKED/UNLINKED once settled; UNAVAILABLE if a required query errored.
 */
export const useReportLinkMatch = (): ReportLinkMatchResult => {
    const matchedOperations = useGetDeviceOperationListPerf();
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

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
    } = useLinkedPerformanceReport();

    if (!activeProfilerReport || !activePerformanceReport) {
        return ReportLinkMatchResult.UNAVAILABLE;
    }

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
