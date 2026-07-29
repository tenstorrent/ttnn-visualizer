// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, AxiosResponse, HttpStatusCode } from 'axios';
import { NpeClientErrorBody, NpeClientErrorKind } from '../definitions/NPEData';

/**
 * Client-side NPE rejection as a synthetic 422 AxiosError so RQ stays typed and
 * getNpeValidationErrorFromFetch can map PARSE → INVALID_JSON / SHAPE → INVALID_NPE_DATA.
 * Body is only the tiny kind marker (never the raw payload). The originating
 * response is required so `config`/`request` pass through to consumers that
 * expect a real AxiosError (CONVENTIONS.md).
 */
export function throwNpeClientAxiosError(message: string, kind: NpeClientErrorKind, response: AxiosResponse): never {
    const data: NpeClientErrorBody = { kind };

    throw new AxiosError(message, AxiosError.ERR_BAD_RESPONSE, response.config, response.request, {
        ...response,
        status: HttpStatusCode.UnprocessableEntity,
        data,
    });
}
