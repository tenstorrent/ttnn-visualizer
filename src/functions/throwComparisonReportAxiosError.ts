// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios, { AxiosError } from 'axios';
import getResponseError from './getResponseError';
import { PERFORMANCE_LOAD_FAILED } from '../definitions/Performance';

/**
 * Rethrows a comparison report's failure with the report named. The comparison
 * reports share one query, so a bare refusal reads as if it were about the active
 * report. Kept an `AxiosError`, status included, so call sites can still branch on
 * it; the body's `error` carries the name too, so `getResponseError` reads it.
 */
export function throwComparisonReportAxiosError(reportName: string, error: unknown): never {
    const message = `${reportName}: ${getResponseError(error, PERFORMANCE_LOAD_FAILED)}`;

    if (!axios.isAxiosError(error)) {
        throw new AxiosError(message, AxiosError.ERR_BAD_RESPONSE);
    }

    const { response } = error;
    const body = response?.data && typeof response.data === 'object' ? response.data : {};

    throw new AxiosError(
        message,
        error.code,
        error.config,
        error.request,
        response && { ...response, data: { ...body, error: message } },
    );
}
