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
