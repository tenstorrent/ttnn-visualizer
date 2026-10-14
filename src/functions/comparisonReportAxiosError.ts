// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios, { AxiosError } from 'axios';
import getResponseError from './getResponseError';
import { PERFORMANCE_LOAD_FAILED } from '../definitions/Performance';

/**
 * A comparison report's failure with the report named. The comparison reports are
 * read together, so a bare refusal reads as if it were about the active report.
 * Kept an `AxiosError`, status included, so a reader can still branch on it; the
 * body's `error` carries the name too, so `getResponseError` reads it.
 */
export function comparisonReportAxiosError(reportName: string, error: unknown): AxiosError {
    const message = `${reportName}: ${getResponseError(error, PERFORMANCE_LOAD_FAILED)}`;

    if (!axios.isAxiosError(error)) {
        return new AxiosError(message, AxiosError.ERR_BAD_RESPONSE);
    }

    const { response } = error;
    const body = response?.data && typeof response.data === 'object' ? response.data : {};

    return new AxiosError(
        message,
        error.code,
        error.config,
        error.request,
        response && { ...response, data: { ...body, error: message } },
    );
}
