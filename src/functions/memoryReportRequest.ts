// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import axiosInstance from '../libs/axiosInstance';
import { ACTIVE_MEMORY_REPORT_HEADER } from '../definitions/ReportHeaders';
import { getReportId } from './reportLinks';

export const REPORT_CHANGED_ERROR_CODE = 'REPORT_CHANGED';

/**
 * An answer for another memory report than the one asked about. It extends `AxiosError`
 * so report hooks keep their `AxiosError` type, and carries no status, so no status
 * check mistakes it for a server error.
 */
export class ReportChangedError extends AxiosError {
    constructor(expectedReportId: string | null, answeredReportId: string | null) {
        super(
            `Asked about memory report ${expectedReportId ?? '(none)'}, answered for ${answeredReportId ?? '(none)'}`,
            REPORT_CHANGED_ERROR_CODE,
        );
        this.name = 'ReportChangedError';
    }
}

export const isReportChangedError = (error: unknown): error is ReportChangedError =>
    error instanceof ReportChangedError;

// TanStack Query's own default: doubles from a second, up to thirty
const defaultRetryDelay = (failureCount: number) => Math.min(1000 * 2 ** failureCount, 30_000);

/**
 * Retry options for a memory-report query. An answer for another report is retried once,
 * at once: a report picked again while its first read is still in flight shares that read,
 * which the server answered for the report picked in between, and by the time it fails
 * this report is active again. A query no longer observed is not retried, so a read left
 * behind by a switch costs nothing more. Other errors keep the hook's own policy.
 */
export const getMemoryReportRetry = (
    retries = 0,
    retryDelay: (failureCount: number) => number = defaultRetryDelay,
) => ({
    retry: (failureCount: number, error: unknown) =>
        isReportChangedError(error) ? failureCount === 0 : failureCount < retries,
    retryDelay: (failureCount: number, error: unknown) => (isReportChangedError(error) ? 0 : retryDelay(failureCount)),
});

type ResponseHeaders = AxiosResponse['headers'] | undefined;

const getAnsweredReportId = (value: string): string | null => {
    try {
        return getReportId(decodeURIComponent(value));
    } catch {
        // Malformed percent-encoding names no report, so it cannot match one
        return null;
    }
};

/**
 * A mismatch, or null when the answer may be cached under `reportId`. A response without
 * the header is accepted: the server always sends it, so only something in between can
 * have removed it, and refusing every answer then would break the app outright.
 */
const getReportChangedError = (headers: ResponseHeaders, reportId: string | null): ReportChangedError | null => {
    const value: unknown = headers?.[ACTIVE_MEMORY_REPORT_HEADER];

    if (typeof value !== 'string') {
        return null;
    }

    const answeredReportId = getAnsweredReportId(value);

    return answeredReportId === reportId ? null : new ReportChangedError(reportId, answeredReportId);
};

/**
 * Reads a memory-report endpoint for the report a query is keyed by. The instance
 * answers for whichever report is active when it handles the request, which can already
 * be a later pick, so an answer for another report is thrown away rather than cached
 * under this one (#2375). Error responses are checked too, so another report's 422 or
 * 404 is not taken for this one's.
 */
export const getMemoryReportData = async <T>(
    url: string,
    reportId: string | null,
    config?: AxiosRequestConfig,
): Promise<T> => {
    let response: AxiosResponse<T>;

    try {
        response = await axiosInstance.get<T>(url, config);
    } catch (error: unknown) {
        throw (axios.isAxiosError(error) && getReportChangedError(error.response?.headers, reportId)) || error;
    }

    const reportChangedError = getReportChangedError(response?.headers, reportId);

    if (reportChangedError) {
        throw reportChangedError;
    }

    return response.data;
};
