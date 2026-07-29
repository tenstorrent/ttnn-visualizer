// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, AxiosResponse, HttpStatusCode } from 'axios';

/**
 * Client-side NPE payload rejection as a synthetic 422 AxiosError so call sites
 * can share one status-aware mapper (getNpeValidationErrorFromFetch, RQ typed errors).
 */
export function throwNpeClientAxiosError(message: string, response?: AxiosResponse | null): never {
    if (response) {
        throw new AxiosError(message, AxiosError.ERR_BAD_RESPONSE, response.config, response.request, {
            ...response,
            status: HttpStatusCode.UnprocessableEntity,
            data: null,
        });
    }

    throw new AxiosError(message, AxiosError.ERR_BAD_RESPONSE, undefined, undefined, {
        data: null,
        status: HttpStatusCode.UnprocessableEntity,
        statusText: 'Unprocessable Entity',
        headers: {},
        // No real request config when the failure is shape-check only (summary/window).
        config: undefined as unknown as AxiosResponse['config'],
    });
}
